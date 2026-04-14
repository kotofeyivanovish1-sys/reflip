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
        const updates = await buildLiveUpdates(listing);
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
async function buildLiveUpdates(listing) {
  const updates = {};

  // Try each linked platform — use whichever succeeds first for price/description
  // (prefer the primary platform the listing was created on)
  const platforms = [];
  if (listing.depopUrl) platforms.push({ name: "depop", url: listing.depopUrl, fn: fetchDepopLive });
  if (listing.vintedUrl) platforms.push({ name: "vinted", url: listing.vintedUrl, fn: fetchVintedLive });
  if (listing.ebayUrl) platforms.push({ name: "ebay", url: listing.ebayUrl, fn: fetchEbayLive });

  // Sort so the primary platform goes first
  const primary = listing.platform || "depop";
  platforms.sort((a, b) => (a.name === primary ? -1 : b.name === primary ? 1 : 0));

  for (const { name, url, fn } of platforms) {
    try {
      const live = await fn(url);
      if (!live) continue;

      // Always update price if changed
      if (live.price > 0 && live.price !== listing.listedPrice) {
        updates.listedPrice = live.price;
      }
      // Always update description from live (source of truth)
      if (live.description && live.description.length > 10) {
        updates.description = live.description;
      }
      // Mark as sold if platform says so
      if (live.status === "sold" && listing.status === "active") {
        updates.status = "sold";
      }
      break; // Got valid data from this platform, no need to check others
    } catch (e) {
      console.warn(`[ReFlip] ${name} fetch failed for listing ${listing.id}:`, e.message);
    }
  }

  return updates;
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
  return {
    price: parseFloat(p.price?.priceAmount || p.preview_price_data?.priceAmount || p.price_amount || "0"),
    description: p.description || "",
    status: p.sold || p.status === 0 ? "sold" : "active",
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

  return {
    price: parseFloat(item.price?.amount || item.total_item_price?.amount || item.price || "0"),
    description: item.description || "",
    status: item.is_closed || item.is_hidden ? "sold" : "active",
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

  return { price, status: isSold ? "sold" : "active" };
}

// ─── Helpers ───
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
