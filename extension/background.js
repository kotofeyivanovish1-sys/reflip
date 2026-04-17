// ReFlip Sync — Background Service Worker
// Automatically syncs all linked listings every 30 minutes using browser-authenticated requests

const SYNC_INTERVAL_MINUTES = 30;

// ─── Setup alarms on install/startup ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("reflip-auto-sync", { periodInMinutes: SYNC_INTERVAL_MINUTES });
  console.log("[ReFlip] Auto-sync alarm set (every 30 min)");
});

// Re-create alarm when service worker starts up (MV3 service workers can be terminated)
chrome.alarms.get("reflip-auto-sync", (alarm) => {
  if (!alarm) {
    chrome.alarms.create("reflip-auto-sync", { periodInMinutes: SYNC_INTERVAL_MINUTES });
  }
});

// ─── Alarm handler ───
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "reflip-auto-sync") {
    console.log("[ReFlip] Background sync triggered by alarm");
    await runBackgroundSync("alarm");
  }
});

// ─── Message handler (from popup and content scripts) ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "sync_all_linked") {
    runBackgroundSync("manual").then(sendResponse);
    return true; // Keep message channel open for async response
  }
  if (msg.action === "get_sync_status") {
    chrome.storage.local.get(["reflip_last_sync", "reflip_sync_updated", "reflip_sync_count"]).then(sendResponse);
    return true;
  }
});

// ─── Core sync function ───
async function runBackgroundSync(trigger = "auto") {
  const stored = await chrome.storage.local.get(["reflip_server", "reflip_token"]);
  if (!stored.reflip_token || !stored.reflip_server) {
    return { skipped: true, reason: "not_logged_in" };
  }

  const serverUrl = stored.reflip_server;
  const token = stored.reflip_token;
  console.log(`[ReFlip] Starting background sync (${trigger})`);

  try {
    // Fetch all linked listings from ReFlip
    const res = await fetch(`${serverUrl}/api/listings/linked`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { error: `API error ${res.status}` };

    const listings = await res.json();
    if (listings.length === 0) return { checked: 0, updated: 0 };

    console.log(`[ReFlip] Syncing ${listings.length} linked listings...`);

    let updated = 0;
    let checked = 0;

    for (const listing of listings) {
      checked++;
      try {
        const { updates, engagement } = await buildLiveUpdates(listing);
        if (Object.keys(updates).length > 0) {
          const patch = await fetch(`${serverUrl}/api/listings/${listing.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(updates),
          });
          if (patch.ok) {
            updated++;
            console.log(`[ReFlip] Updated #${listing.id} (${listing.title?.slice(0, 30)}): ${Object.keys(updates).join(", ")}`);
          }
        }
        // Push engagement data (views/likes/favorites/watchers) per platform
        for (const e of engagement) {
          try {
            await fetch(`${serverUrl}/api/listings/${listing.id}/engagement`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(e),
            });
            console.log(`[ReFlip] Engagement #${listing.id} ${e.platform}: views=${e.views} likes/favs/watchers=${e.likes ?? e.favorites ?? e.watchers}`);
          } catch (err) {
            console.warn(`[ReFlip] Engagement push failed:`, err.message);
          }
        }
      } catch (e) {
        console.warn(`[ReFlip] Failed to sync listing ${listing.id}:`, e.message);
      }
      // Small delay to avoid hammering platform APIs
      if (checked % 5 === 0) await sleep(500);
    }

    const result = {
      checked,
      updated,
      timestamp: new Date().toISOString(),
      trigger,
    };

    await chrome.storage.local.set({
      reflip_last_sync: result.timestamp,
      reflip_sync_updated: updated,
      reflip_sync_count: checked,
    });

    console.log(`[ReFlip] Sync done: ${updated}/${checked} listings updated`);
    return result;
  } catch (e) {
    console.error("[ReFlip] Background sync error:", e);
    return { error: e.message };
  }
}

// ─── Build updates for a single listing by fetching live platform data ───
// Returns { updates: {...}, engagement: [{platform, views, likes|favorites|watchers, currentPrice}, ...] }
async function buildLiveUpdates(listing) {
  const updates = {};
  const engagement = [];

  const platforms = [];
  if (listing.depopUrl) platforms.push({ name: "depop", url: listing.depopUrl, fn: fetchDepopLive });
  if (listing.vintedUrl) platforms.push({ name: "vinted", url: listing.vintedUrl, fn: fetchVintedLive });
  if (listing.ebayUrl) platforms.push({ name: "ebay", url: listing.ebayUrl, fn: fetchEbayLive });

  const primary = listing.platform || "depop";
  platforms.sort((a, b) => (a.name === primary ? -1 : b.name === primary ? 1 : 0));

  let descSet = false, priceSet = false, soldSet = false;

  for (const { name, url, fn } of platforms) {
    try {
      const live = await fn(url);
      if (!live) continue;

      // Price/description/status: take first successful read (primary platform wins)
      if (!priceSet && live.price > 0 && live.price !== listing.listedPrice) {
        updates.listedPrice = live.price;
        priceSet = true;
      }
      if (!descSet && live.description && live.description.length > 10) {
        updates.description = live.description;
        descSet = true;
      }
      if (!soldSet && live.status === "sold" && listing.status === "active") {
        updates.status = "sold";
        soldSet = true;
      }

      // Engagement: ALWAYS push per-platform (separate storage columns)
      const hasEngagement = live.views != null || live.likes != null || live.favorites != null || live.watchers != null;
      if (hasEngagement) {
        const e = { platform: name };
        if (live.views != null) e.views = live.views;
        if (name === "depop" && live.likes != null) e.likes = live.likes;
        if (name === "vinted" && live.favorites != null) e.favorites = live.favorites;
        if (name === "ebay" && live.watchers != null) e.watchers = live.watchers;
        if (live.price > 0) e.currentPrice = live.price;
        engagement.push(e);
      }
    } catch (e) {
      console.warn(`[ReFlip] ${name} fetch failed for listing ${listing.id}:`, e.message);
    }
  }

  return { updates, engagement };
}

// ─── Depop live fetch (uses browser cookies via chrome.cookies API) ───
async function fetchDepopLive(url) {
  const slug = url.match(/products\/([A-Za-z0-9_.-]+)/)?.[1];
  if (!slug) return null;

  // Get user's Depop cookies from browser (background worker can't use credentials:include)
  const cookies = await chrome.cookies.getAll({ domain: "depop.com" }).catch(() => []);
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "depop-user-country": "US",
    "depop-user-currency": "USD",
    "Referer": "https://www.depop.com/",
    "Origin": "https://www.depop.com",
  };
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  // Try v2 API first
  let res = await fetch(`https://webapi.depop.com/api/v2/products/${slug}/`, { headers });

  // Fallback to v1 if v2 fails
  if (!res.ok) {
    res = await fetch(`https://webapi.depop.com/api/v1/products/${slug}/`, { headers });
  }
  if (!res.ok) return null;

  const p = await res.json();
  // Engagement fields — try every known key; Depop has shifted these between API versions
  const likes = firstNumber(p.likes_count, p.likesCount, p.num_likes, p.numLikes, p.favorites_count, p.favouritesCount);
  const views = firstNumber(p.views_count, p.viewsCount, p.num_views, p.numViews, p.view_count, p.impressions);
  return {
    price: parseFloat(p.price?.priceAmount || p.preview_price_data?.priceAmount || p.price_amount || "0"),
    description: p.description || "",
    status: p.sold || p.status === 0 ? "sold" : "active",
    likes,
    views,
  };
}

// ─── Vinted live fetch ───
async function fetchVintedLive(url) {
  const idMatch = url.match(/\/items\/(\d+)/);
  if (!idMatch) return null;

  let host = "www.vinted.com";
  try { host = new URL(url).hostname; } catch {}

  const baseDomain = host.replace(/^www\./, "");
  const cookies = await chrome.cookies.getAll({ domain: baseDomain }).catch(() => []);
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": `https://${host}/`,
  };
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const res = await fetch(`https://${host}/api/v2/items/${idMatch[1]}`, { headers });
  if (!res.ok) return null;

  const data = await res.json();
  const item = data.item || data;
  if (!item.id) return null;

  const favorites = firstNumber(item.favourite_count, item.favouritesCount, item.favorites_count, item.favoritesCount, item.num_favourites, item.likes_count);
  const views = firstNumber(item.view_count, item.viewCount, item.views_count, item.views, item.view_count_total);

  return {
    price: parseFloat(item.price?.amount || item.total_item_price?.amount || item.price || "0"),
    description: item.description || "",
    status: item.is_closed || item.is_hidden ? "sold" : "active",
    favorites,
    views,
  };
}

// ─── eBay live fetch ───
async function fetchEbayLive(url) {
  const cookies = await chrome.cookies.getAll({ domain: "ebay.com" }).catch(() => []);
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
  };
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) return null;
  const html = await res.text();

  // Extract current price
  const priceMatch = html.match(/itemprop="price"\s+content="([^"]+)"/)
    || html.match(/data-testid="x-price-section"[^>]*>[\s\S]{0,200}?\$(\d+[\d,]*(?:\.\d{2})?)/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0;

  const isSold = /listing ended|item sold|no longer available|bidding has ended/i.test(html);

  // Watchers — eBay shows "X watchers" or "X watching" on seller-accessible item pages
  const watchersMatch = html.match(/(\d+)\s*(?:people\s*)?watch(?:ing|er)s?/i)
    || html.match(/"watchCount"\s*:\s*(\d+)/)
    || html.match(/data-testid="[^"]*watch[^"]*"[^>]*>[^<]*?(\d+)/i);
  const watchers = watchersMatch ? parseInt(watchersMatch[1], 10) : null;

  // Views — sometimes present in item metadata
  const viewsMatch = html.match(/(\d+)\s*views?\s*in\s*the\s*last\s*24\s*hours/i)
    || html.match(/"viewItemCount"\s*:\s*(\d+)/);
  const views = viewsMatch ? parseInt(viewsMatch[1], 10) : null;

  return { price, status: isSold ? "sold" : "active", watchers, views };
}

// Pick the first finite numeric argument, else null
function firstNumber(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = typeof c === "number" ? c : parseInt(String(c), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ─── Helpers ───
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
