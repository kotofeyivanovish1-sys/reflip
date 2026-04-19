const SUPPORTED_LIVE_PLATFORMS = ["ebay", "depop", "vinted"];
const LIVE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const METRIC_KEYS = ["views", "clicks", "favorites", "likes", "watchers", "shares", "saves"];
const INTEREST_KEYS = ["favorites", "likes", "watchers", "saves"];

function cleanText(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function toCount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    const multiplier = normalized.endsWith("k") ? 1000 : normalized.endsWith("m") ? 1000000 : 1;
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * multiplier);
  }
  return null;
}

function toPrice(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(numeric)) return null;
    return Number(numeric.toFixed(2));
  }
  return null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function canonicalizeExternalUrl(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return input;
  }
}

export function normalizeLiveStatus(value) {
  const normalized = String(value || "unknown").toLowerCase();
  if (/(sold|ended|outofstock|out of stock|unavailable)/.test(normalized)) return "sold";
  if (/(reserve|pending)/.test(normalized)) return "reserved";
  if (/(remove|delete|hidden|inactive)/.test(normalized)) return "removed";
  if (/(active|instock|in stock|for sale|available)/.test(normalized)) return "active";
  return "unknown";
}

export function classifyFreshness(timestamp, maxAgeMs = LIVE_STALE_AFTER_MS) {
  const parsed = isoDate(timestamp);
  if (!parsed) return "unknown";
  const age = Date.now() - new Date(parsed).getTime();
  return age <= maxAgeMs ? "fresh" : "stale";
}

export function deriveInterestCount(metrics) {
  for (const key of INTEREST_KEYS) {
    const value = toCount(metrics?.[key]);
    if (value != null) return value;
  }
  return null;
}

export function normalizeMetrics(input = {}, options = {}) {
  const capturedAt = isoDate(options.capturedAt ?? input.capturedAt) ?? null;
  const metrics = {};

  for (const key of METRIC_KEYS) {
    metrics[key] = toCount(input[key]);
  }

  metrics.interestCount = toCount(input.interestCount);
  if (metrics.interestCount == null) {
    metrics.interestCount = deriveInterestCount(metrics);
  }

  metrics.metricsSource = input.metricsSource ?? options.source ?? "manual";
  metrics.capturedAt = capturedAt;
  metrics.metricsFreshness = input.metricsFreshness ?? classifyFreshness(capturedAt);

  return metrics;
}

export function emptyMetrics(source = "manual") {
  return normalizeMetrics({}, { source, capturedAt: null });
}

export function normalizeChannel(input = {}) {
  return {
    platform: input.platform ?? null,
    externalUrl: canonicalizeExternalUrl(input.externalUrl),
    externalListingId: input.externalListingId ?? null,
    liveTitle: cleanText(input.liveTitle),
    liveDescription: cleanText(input.liveDescription),
    livePrice: toPrice(input.livePrice),
    liveCurrency: input.liveCurrency ?? null,
    liveStatus: normalizeLiveStatus(input.liveStatus),
    lastSeenAt: isoDate(input.lastSeenAt),
    lastRefreshAttemptAt: isoDate(input.lastRefreshAttemptAt),
    source: input.source ?? "manual",
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0,
    lastError: input.lastError ?? null,
    metrics: normalizeMetrics(input.metrics, {
      source: input.metricsSource ?? input.metrics?.metricsSource ?? "manual",
      capturedAt: input.metrics?.capturedAt ?? input.capturedAt ?? null
    })
  };
}

export function channelFreshness(channel) {
  return classifyFreshness(channel?.lastSeenAt);
}

function findMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return null;
}

function extractJsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
}

function parseJsonValue(block) {
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

function findProductJsonLd(html) {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const parsed = parseJsonValue(block);
    if (!parsed) continue;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item?.["@type"] === "Product") return item;
      if (Array.isArray(item?.["@graph"])) {
        const product = item["@graph"].find((entry) => entry?.["@type"] === "Product");
        if (product) return product;
      }
    }
  }
  return null;
}

function getOffer(product) {
  if (!product?.offers) return null;
  return Array.isArray(product.offers) ? product.offers[0] : product.offers;
}

function extractTitle(html) {
  const fromOg = findMetaContent(html, "og:title");
  if (fromOg) return fromOg;
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return cleanText(match?.[1]);
}

function extractDescription(html) {
  return (
    findMetaContent(html, "og:description")
    || findMetaContent(html, "description")
    || cleanText(findProductJsonLd(html)?.description)
  );
}

function matchCount(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const count = toCount(match?.[1]);
    if (count != null) return count;
  }
  return null;
}

function findPriceFromHtml(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const price = toPrice(match?.[1]);
    if (price != null) return price;
  }
  return null;
}

function parseEbay(html, channel) {
  const product = findProductJsonLd(html);
  const offer = getOffer(product);
  const now = new Date().toISOString();
  const metrics = normalizeMetrics(
    {
      views: matchCount(html, [
        /([0-9,]+)\s+(?:page\s+)?views\b/i,
        /"itemViewCount"\s*:\s*"?(.*?)"/i
      ]),
      watchers: matchCount(html, [
        /([0-9,]+)\s+(?:people\s+)?watch(?:ing|ers?)\b/i,
        /"watchCount"\s*:\s*"?(.*?)"/i
      ])
    },
    { source: "official", capturedAt: now }
  );

  return normalizeChannel({
    ...channel,
    liveTitle: product?.name || extractTitle(html),
    liveDescription: product?.description || extractDescription(html),
    livePrice: offer?.price ?? findPriceFromHtml(html, [
      /"price"\s*:\s*"([0-9.]+)"/i,
      /content=["']([0-9.]+)["'][^>]+property=["']product:price:amount["']/i
    ]),
    liveCurrency: offer?.priceCurrency || findMetaContent(html, "product:price:currency") || "USD",
    liveStatus: normalizeLiveStatus(
      offer?.availability
      || (/this listing was ended|out of stock|no longer available/i.test(html) ? "sold" : "active")
    ),
    lastSeenAt: now,
    lastRefreshAttemptAt: now,
    source: "official",
    confidence: product?.name || offer?.price ? 92 : 64,
    lastError: null,
    metrics
  });
}

function parseDepop(html, channel) {
  const product = findProductJsonLd(html);
  const offer = getOffer(product);
  const now = new Date().toISOString();
  const metrics = normalizeMetrics(
    {
      views: matchCount(html, [
        /([0-9,]+)\s+views\b/i,
        /"views"\s*:\s*([0-9]+)/i
      ]),
      clicks: matchCount(html, [
        /([0-9,]+)\s+clicks\b/i,
        /"clicks"\s*:\s*([0-9]+)/i
      ]),
      likes: matchCount(html, [
        /([0-9,]+)\s+likes\b/i,
        /"likes"\s*:\s*([0-9]+)/i
      ])
    },
    { source: "official", capturedAt: now }
  );

  return normalizeChannel({
    ...channel,
    liveTitle: product?.name || extractTitle(html),
    liveDescription: product?.description || extractDescription(html),
    livePrice: offer?.price ?? findPriceFromHtml(html, [
      /content=["']([0-9.]+)["'][^>]+property=["']product:price:amount["']/i,
      /"price"\s*:\s*"([0-9.]+)"/i
    ]),
    liveCurrency: offer?.priceCurrency || findMetaContent(html, "product:price:currency") || "USD",
    liveStatus: normalizeLiveStatus(
      offer?.availability
      || (/sold out|this item has sold|item sold/i.test(html) ? "sold" : "active")
    ),
    lastSeenAt: now,
    lastRefreshAttemptAt: now,
    source: "official",
    confidence: product?.name || offer?.price ? 86 : 58,
    lastError: null,
    metrics
  });
}

function parseVinted(html, channel) {
  const product = findProductJsonLd(html);
  const offer = getOffer(product);
  const now = new Date().toISOString();
  const metrics = normalizeMetrics(
    {
      favorites: matchCount(html, [
        /([0-9,]+)\s+favo(?:u)?rites?\b/i,
        /([0-9,]+)\s+members?\s+interested\b/i
      ]),
      views: matchCount(html, [
        /([0-9,]+)\s+views\b/i,
        /"views"\s*:\s*([0-9]+)/i
      ])
    },
    { source: "official", capturedAt: now }
  );

  return normalizeChannel({
    ...channel,
    liveTitle: product?.name || extractTitle(html),
    liveDescription: product?.description || extractDescription(html),
    livePrice: offer?.price ?? findPriceFromHtml(html, [
      /content=["']([0-9.]+)["'][^>]+property=["']product:price:amount["']/i,
      /"price"\s*:\s*"([0-9.]+)"/i
    ]),
    liveCurrency: offer?.priceCurrency || findMetaContent(html, "product:price:currency") || "USD",
    liveStatus: normalizeLiveStatus(
      offer?.availability
      || (/sold|reserved/i.test(html) ? "sold" : "active")
    ),
    lastSeenAt: now,
    lastRefreshAttemptAt: now,
    source: "official",
    confidence: product?.name || offer?.price ? 84 : 56,
    lastError: null,
    metrics
  });
}

const PLATFORM_PARSERS = {
  ebay: parseEbay,
  depop: parseDepop,
  vinted: parseVinted
};

function parseEbayUrl(url) {
  const match = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/i);
  return match?.[1] ?? null;
}

function parseDepopUrl(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "products" && parts[1]) return parts[1];
  return parts.at(-1) ?? null;
}

function parseVintedUrl(url) {
  const match = url.pathname.match(/\/items\/(\d+)/i);
  return match?.[1] ?? null;
}

export function parseMarketplaceUrl(input) {
  const url = new URL(input);
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let platform = null;
  let externalListingId = null;

  if (host.includes("ebay.")) {
    platform = "ebay";
    externalListingId = parseEbayUrl(url);
  } else if (host.includes("depop.")) {
    platform = "depop";
    externalListingId = parseDepopUrl(url);
  } else if (host.includes("vinted.")) {
    platform = "vinted";
    externalListingId = parseVintedUrl(url);
  }

  if (!platform || !externalListingId) {
    throw new Error("Unsupported or invalid marketplace URL");
  }

  return {
    platform,
    externalListingId,
    externalUrl: canonicalizeExternalUrl(url.toString())
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshLiveChannel(channel) {
  const normalized = normalizeChannel(channel);
  const now = new Date().toISOString();

  if (!normalized.externalUrl || !SUPPORTED_LIVE_PLATFORMS.includes(normalized.platform)) {
    return {
      channel: normalizeChannel({
        ...normalized,
        lastRefreshAttemptAt: now,
        lastError: "Live sync is not implemented for this platform yet"
      }),
      refreshed: false
    };
  }

  try {
    const response = await fetchWithTimeout(normalized.externalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error(`Marketplace returned ${response.status}`);
    }

    const html = await response.text();
    const parser = PLATFORM_PARSERS[normalized.platform];
    const parsed = parser(html, {
      ...normalized,
      externalUrl: canonicalizeExternalUrl(response.url || normalized.externalUrl)
    });

    return { channel: parsed, refreshed: true };
  } catch (error) {
    return {
      channel: normalizeChannel({
        ...normalized,
        lastRefreshAttemptAt: now,
        lastError: error.message
      }),
      refreshed: false,
      error
    };
  }
}

export function mergeChannelSnapshot(channel, snapshot = {}) {
  const merged = {
    ...channel,
    ...snapshot,
    metrics: snapshot.metrics
      ? normalizeMetrics(snapshot.metrics, {
          source: snapshot.metrics.metricsSource ?? snapshot.source ?? channel?.metrics?.metricsSource ?? "manual",
          capturedAt: snapshot.metrics.capturedAt ?? snapshot.capturedAt ?? new Date().toISOString()
        })
      : channel?.metrics
  };

  return normalizeChannel(merged);
}

export function buildDivergences(listing, channels) {
  return channels.flatMap((channel) => {
    const diffs = [];
    if (channel.liveTitle && listing.title && channel.liveTitle !== listing.title) {
      diffs.push({ platform: channel.platform, field: "title", local: listing.title, live: channel.liveTitle });
    }
    if (channel.liveDescription && listing.description && channel.liveDescription !== listing.description) {
      diffs.push({
        platform: channel.platform,
        field: "description",
        local: listing.description,
        live: channel.liveDescription
      });
    }
    if (channel.livePrice != null && listing.listedPrice != null && channel.livePrice !== listing.listedPrice) {
      diffs.push({
        platform: channel.platform,
        field: "listedPrice",
        local: listing.listedPrice,
        live: channel.livePrice
      });
    }
    return diffs;
  });
}

export function summarizeEngagement(channels) {
  const byPlatform = channels.map((channel) => ({
    platform: channel.platform,
    views: channel.metrics?.views ?? null,
    interestCount: channel.metrics?.interestCount ?? null,
    metricsFreshness: channel.metrics?.metricsFreshness ?? "unknown",
    liveFreshness: channelFreshness(channel),
    status: channel.liveStatus
  }));

  return {
    totalViews: byPlatform.reduce((sum, item) => sum + (item.views ?? 0), 0),
    totalInterest: byPlatform.reduce((sum, item) => sum + (item.interestCount ?? 0), 0),
    byPlatform
  };
}

export {
  INTEREST_KEYS,
  LIVE_STALE_AFTER_MS,
  METRIC_KEYS,
  SUPPORTED_LIVE_PLATFORMS
};
