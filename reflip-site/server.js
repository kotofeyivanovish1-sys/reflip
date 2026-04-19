import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { DataStore } from "./src/store.js";
import { generateDashboardRecommendations, generateQuickListing, generateScanAnalysis, suggestListingImprovements } from "./src/ai.js";
import { channelFreshness, parseMarketplaceUrl, refreshLiveChannel } from "./src/liveSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data", "app-data.json");
const store = new DataStore(dataFile);
const port = Number(process.env.PORT || 3000);

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const marker = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(marker);

  while (start !== -1) {
    const next = buffer.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = buffer.subarray(start + marker.length + 2, next - 2);
    start = next;
    if (!part.length) continue;

    const separator = part.indexOf(Buffer.from("\r\n\r\n"));
    if (separator === -1) continue;

    const headerText = part.subarray(0, separator).toString("utf8");
    const value = part.subarray(separator + 4);
    const nameMatch = headerText.match(/name="([^"]+)"/);
    const fileMatch = headerText.match(/filename="([^"]*)"/);
    if (!nameMatch) continue;

    parts.push({
      name: nameMatch[1],
      filename: fileMatch?.[1] || null,
      value
    });
  }

  return parts;
}

async function parseMultipartForm(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    return { fields: {}, files: [] };
  }

  const buffer = await readBody(req);
  const parts = parseMultipart(buffer, boundaryMatch[1]);
  const fields = {};
  const files = [];

  for (const part of parts) {
    if (part.filename) {
      files.push({
        field: part.name,
        filename: part.filename,
        size: part.value.length
      });
    } else {
      fields[part.name] = part.value.toString("utf8");
    }
  }

  return { fields, files };
}

function makeQrDataUrl(bagNumber) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <rect width="320" height="320" rx="28" fill="#ffffff"/>
      <rect x="24" y="24" width="272" height="272" rx="24" fill="#111827"/>
      <rect x="54" y="54" width="70" height="70" fill="#ffffff"/>
      <rect x="196" y="54" width="70" height="70" fill="#ffffff"/>
      <rect x="54" y="196" width="70" height="70" fill="#ffffff"/>
      <rect x="154" y="154" width="20" height="20" fill="#ffffff"/>
      <rect x="184" y="154" width="20" height="20" fill="#ffffff"/>
      <rect x="214" y="154" width="20" height="20" fill="#ffffff"/>
      <rect x="154" y="184" width="50" height="20" fill="#ffffff"/>
      <rect x="214" y="184" width="20" height="50" fill="#ffffff"/>
      <rect x="154" y="214" width="20" height="20" fill="#ffffff"/>
      <rect x="184" y="244" width="50" height="20" fill="#ffffff"/>
      <text x="160" y="300" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#111827">BAG #${bagNumber}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function normalizeListingInput(body) {
  return {
    ...body,
    costPrice: body.costPrice == null ? 0 : Number(body.costPrice),
    listedPrice: body.listedPrice == null || body.listedPrice === "" ? null : Number(body.listedPrice),
    soldPrice: body.soldPrice == null || body.soldPrice === "" ? null : Number(body.soldPrice)
  };
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function getListingOr404(res, id) {
  const listing = store.getListing(id);
  if (!listing) {
    notFound(res);
    return null;
  }
  return listing;
}

async function refreshPersistedChannel(listingId, platform) {
  const listing = store.getListing(listingId);
  const channel = listing?.channels?.find((item) => item.platform === platform) ?? null;
  if (!listing || !channel) {
    return null;
  }

  const result = await refreshLiveChannel(channel);
  const updatedChannel = store.updateChannel(listingId, platform, result.channel);
  if (updatedChannel?.metrics) {
    store.recordChannelMetricsHistory(
      listingId,
      platform,
      updatedChannel.metrics,
      updatedChannel.metrics.metricsSource,
      updatedChannel.metrics.capturedAt ?? updatedChannel.lastSeenAt
    );
  }

  return {
    refreshed: result.refreshed,
    channel: updatedChannel,
    liveView: store.getLiveView(listingId),
    error: result.error?.message ?? null
  };
}

async function refreshListingLiveView(listingId, { staleOnly = true } = {}) {
  const listing = store.getListing(listingId);
  if (!listing) return null;

  for (const channel of listing.channels ?? []) {
    const isStale = channelFreshness(channel) !== "fresh" || channel.metrics?.metricsFreshness === "stale";
    if (!staleOnly || isStale) {
      await refreshPersistedChannel(listingId, channel.platform);
    }
  }

  return store.getLiveView(listingId);
}

function normalizeLiveSnapshotInput(body = {}) {
  return {
    platform: body.platform,
    externalUrl: body.externalUrl ?? body.url ?? null,
    externalListingId: body.externalListingId ?? null,
    liveTitle: body.liveTitle ?? body.title ?? null,
    liveDescription: body.liveDescription ?? body.description ?? null,
    livePrice: body.livePrice ?? body.price ?? null,
    liveCurrency: body.liveCurrency ?? body.currency ?? null,
    liveStatus: body.liveStatus ?? body.status ?? null,
    source: body.source ?? "manual",
    confidence: body.confidence,
    capturedAt: body.capturedAt ?? new Date().toISOString(),
    metrics: body.metrics ?? {
      views: body.views,
      clicks: body.clicks,
      favorites: body.favorites,
      likes: body.likes,
      watchers: body.watchers,
      shares: body.shares,
      saves: body.saves,
      interestCount: body.interestCount,
      metricsSource: body.metricsSource ?? body.source ?? "manual",
      capturedAt: body.capturedAt ?? new Date().toISOString()
    }
  };
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(publicDir, "index.html");
    sendText(res, 200, fs.readFileSync(indexPath), "text/html; charset=utf-8");
    return;
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".json"
            ? "application/json; charset=utf-8"
            : "application/octet-stream";

  sendText(res, 200, fs.readFileSync(filePath), contentType);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";
  const listingChannelRefreshMatch = pathname.match(/^\/api\/listings\/(\d+)\/channels\/([^/]+)\/refresh$/);
  const listingChannelDeleteMatch = pathname.match(/^\/api\/listings\/(\d+)\/channels\/([^/]+)$/);
  const listingChannelsMatch = pathname.match(/^\/api\/listings\/(\d+)\/channels$/);
  const listingLiveViewMatch = pathname.match(/^\/api\/listings\/(\d+)\/live-view$/);
  const listingEngagementMatch = pathname.match(/^\/api\/listings\/(\d+)\/engagement$/);
  const listingIdMatch = pathname.match(/^\/api\/listings\/(\d+)$/);

  if (pathname === "/api/listings" && method === "GET") {
    return sendJson(
      res,
      200,
      store.listListings({
        status: url.searchParams.get("status"),
        platform: url.searchParams.get("platform")
      })
    );
  }

  if (pathname === "/api/listings" && method === "POST") {
    const body = normalizeListingInput(await parseJson(req));
    return sendJson(res, 201, store.createListing(body));
  }

  if (listingChannelsMatch && method === "GET") {
    const listingId = Number(listingChannelsMatch[1]);
    const listing = getListingOr404(res, listingId);
    if (!listing) return;
    return sendJson(res, 200, listing.channels ?? []);
  }

  if (pathname.match(/^\/api\/listings\/(\d+)\/channels\/attach$/) && method === "POST") {
    const listingId = Number(pathname.match(/^\/api\/listings\/(\d+)\/channels\/attach$/)[1]);
    const listing = getListingOr404(res, listingId);
    if (!listing) return;

    const body = await parseJson(req);
    if (!body.url) {
      return badRequest(res, "A marketplace URL is required.");
    }

    let parsed;
    try {
      parsed = parseMarketplaceUrl(body.url);
    } catch (error) {
      return badRequest(res, error.message);
    }

    const attached = store.attachChannel(listingId, {
      ...parsed,
      source: "manual",
      confidence: 72
    });

    if (!attached) return notFound(res);

    const refreshed = await refreshPersistedChannel(listingId, parsed.platform);
    return sendJson(res, 201, {
      channel: refreshed?.channel ?? attached,
      liveView: refreshed?.liveView ?? store.getLiveView(listingId)
    });
  }

  if (listingChannelRefreshMatch && method === "POST") {
    const listingId = Number(listingChannelRefreshMatch[1]);
    const platform = listingChannelRefreshMatch[2];
    const listing = getListingOr404(res, listingId);
    if (!listing) return;

    if (!(listing.channels ?? []).some((channel) => channel.platform === platform)) {
      return notFound(res);
    }

    const refreshed = await refreshPersistedChannel(listingId, platform);
    return sendJson(res, 200, refreshed);
  }

  if (listingChannelDeleteMatch && method === "DELETE") {
    const listingId = Number(listingChannelDeleteMatch[1]);
    const platform = listingChannelDeleteMatch[2];
    const listing = getListingOr404(res, listingId);
    if (!listing) return;

    const deleted = store.deleteChannel(listingId, platform);
    return deleted ? sendJson(res, 200, { ok: true }) : notFound(res);
  }

  if (listingLiveViewMatch && method === "GET") {
    const listingId = Number(listingLiveViewMatch[1]);
    const listing = getListingOr404(res, listingId);
    if (!listing) return;

    const liveView = await refreshListingLiveView(listingId, { staleOnly: true });
    return sendJson(res, 200, liveView ?? store.getLiveView(listingId));
  }

  if (listingEngagementMatch && method === "GET") {
    const listingId = Number(listingEngagementMatch[1]);
    const listing = getListingOr404(res, listingId);
    if (!listing) return;

    const days = Number(url.searchParams.get("days") || 30);
    return sendJson(res, 200, store.getEngagementHistory(listingId, days));
  }

  if (listingIdMatch) {
    const id = Number(listingIdMatch[1]);
    if (!id) return notFound(res);

    if (method === "GET") {
      const listing = store.getListing(id);
      return listing ? sendJson(res, 200, listing) : notFound(res);
    }

    if (method === "PATCH") {
      const body = normalizeListingInput(await parseJson(req));
      const updated = store.updateListing(id, body);
      return updated ? sendJson(res, 200, updated) : notFound(res);
    }

    if (method === "DELETE") {
      const deleted = store.deleteListing(id);
      return deleted ? sendJson(res, 200, { ok: true }) : notFound(res);
    }
  }

  if (pathname === "/api/bags" && method === "GET") {
    return sendJson(res, 200, store.getBags());
  }

  if (pathname.match(/^\/api\/bags\/\d+\/qr$/) && method === "GET") {
    const bagNumber = Number(pathname.split("/")[3]);
    const bag = store.getBag(bagNumber);
    if (!bag) return notFound(res);
    return sendJson(res, 200, { qrDataUrl: makeQrDataUrl(bagNumber) });
  }

  if (pathname === "/api/scan-history" && method === "GET") {
    return sendJson(res, 200, store.getScanHistory());
  }

  if (pathname === "/api/stats/dashboard" && method === "GET") {
    return sendJson(res, 200, store.getDashboardStats());
  }

  if (pathname === "/api/stats/platforms" && method === "GET") {
    return sendJson(res, 200, store.getPlatformStats());
  }

  if (pathname === "/api/live-snapshots" && method === "POST") {
    const body = normalizeLiveSnapshotInput(await parseJson(req));
    if (!body.platform || !body.externalUrl) {
      return badRequest(res, "platform and externalUrl are required.");
    }

    const updated = store.applyLiveSnapshot(body);
    return updated
      ? sendJson(res, 200, {
          ok: true,
          listing: updated.listing,
          channel: updated.channel,
          liveView: store.getLiveView(updated.listing.id)
        })
      : sendJson(res, 404, { error: "No linked listing matches this live snapshot." });
  }

  if (pathname === "/api/ai/scan" && method === "POST") {
    const body = await parseJson(req);
    const analysis = generateScanAnalysis({ query: body.query || "", size: body.size || "" });
    store.addScanHistory(body.query || analysis.itemName, analysis);
    return sendJson(res, 200, analysis);
  }

  if (pathname === "/api/ai/scan-image" && method === "POST") {
    const { fields, files } = await parseMultipartForm(req);
    const filenameText = files.map((file) => file.filename).join(" ");
    const query = filenameText || "uploaded thrift item";
    const analysis = generateScanAnalysis({ query, size: fields.size || "", source: "image" });
    store.addScanHistory(query, analysis);
    return sendJson(res, 200, analysis);
  }

  if (pathname === "/api/ai/quick-listing" && method === "POST") {
    const { fields, files } = await parseMultipartForm(req);
    const listing = await generateQuickListing({
      description: fields.description || "",
      imageCount: files.length,
      filenames: files.map((file) => file.filename)
    });
    return sendJson(res, 200, listing);
  }

  if (pathname === "/api/ai/suggest" && method === "POST") {
    const body = await parseJson(req);
    const listingId = Number(body.listingId);
    const listing = store.getListing(listingId);
    if (!listing) return notFound(res);
    const liveView = await refreshListingLiveView(listingId, { staleOnly: true });
    const engagementHistory = store.getEngagementHistory(listingId, 30);
    return sendJson(res, 200, suggestListingImprovements(listing, liveView, engagementHistory));
  }

  if (pathname === "/api/ai/recommendations" && method === "POST") {
    const dashboard = store.getDashboardStats();
    const platforms = store.getPlatformStats();
    return sendJson(res, 200, generateDashboardRecommendations(dashboard, platforms));
  }

  return notFound(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`ReFlip is running at http://localhost:${port}`);
});
