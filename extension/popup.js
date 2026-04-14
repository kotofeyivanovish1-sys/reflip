// ReFlip Sync — Popup Controller

const $ = (s) => document.querySelector(s);

let config = { serverUrl: "", token: "", email: "" };

// ─── Init ───
document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(["reflip_server", "reflip_token", "reflip_email"]);
  if (stored.reflip_token && stored.reflip_server) {
    config.serverUrl = stored.reflip_server;
    config.token = stored.reflip_token;
    config.email = stored.reflip_email || "";
    showMain();
    // Load last sync status
    loadSyncStatus();
  } else {
    showLogin();
  }

  // Load last log
  const { reflip_log } = await chrome.storage.local.get("reflip_log");
  if (reflip_log) renderLog(reflip_log);

  const { reflip_stats } = await chrome.storage.local.get("reflip_stats");
  if (reflip_stats) {
    $("#synced-count").textContent = reflip_stats.synced || 0;
    $("#new-count").textContent = reflip_stats.created || 0;
  }
});

async function loadSyncStatus() {
  try {
    const status = await chrome.storage.local.get(["reflip_last_sync", "reflip_sync_updated", "reflip_sync_count"]);
    const el = $("#last-sync-text");
    if (!el) return;
    if (status.reflip_last_sync) {
      const d = new Date(status.reflip_last_sync);
      const timeStr = d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
      const dateStr = d.toLocaleDateString("en", { month: "short", day: "numeric" });
      el.textContent = `Last sync: ${dateStr} ${timeStr} — ${status.reflip_sync_updated || 0} updated`;
    } else {
      el.textContent = "Last sync: never (will run in ~30 min)";
    }
  } catch {}
}

function showLogin() {
  $("#login-section").style.display = "block";
  $("#main-section").style.display = "none";
}

function showMain() {
  $("#login-section").style.display = "none";
  $("#main-section").style.display = "block";
  $("#status-text").textContent = `Connected as ${config.email}`;
}

// ─── Login ───
$("#login-btn").addEventListener("click", async () => {
  let serverUrl = $("#server-url").value.trim().replace(/\/$/, "");
  if (serverUrl && !serverUrl.startsWith("http")) {
    serverUrl = `https://${serverUrl}`;
  }
  const email = $("#email").value.trim();
  const password = $("#password").value;

  if (!serverUrl || !email || !password) {
    showError("Fill in all fields");
    return;
  }

  $("#login-btn").disabled = true;
  $("#login-btn").textContent = "Connecting...";

  try {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) throw new Error(data.message || "Login failed");

    config = { serverUrl, token: data.token, email };
    await chrome.storage.local.set({
      reflip_server: serverUrl,
      reflip_token: data.token,
      reflip_email: email,
    });
    showMain();
  } catch (e) {
    showError(e.message);
  } finally {
    $("#login-btn").disabled = false;
    $("#login-btn").textContent = "Connect";
  }
});

function showError(msg) {
  const el = $("#login-error");
  el.style.display = "block";
  el.textContent = msg;
}

// ─── Disconnect ───
$("#disconnect-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["reflip_server", "reflip_token", "reflip_email"]);
  config = { serverUrl: "", token: "", email: "" };
  showLogin();
});

// ─── Refresh All Linked Listings (uses background.js) ───
$("#refresh-all-btn").addEventListener("click", async () => {
  const btn = $("#refresh-all-btn");
  const statusEl = $("#refresh-status");
  btn.disabled = true;
  btn.textContent = "Syncing...";
  statusEl.style.display = "block";
  statusEl.textContent = "Fetching live prices from platforms...";

  try {
    const result = await chrome.runtime.sendMessage({ action: "sync_all_linked" });
    if (result && result.error) {
      statusEl.textContent = `Error: ${result.error}`;
      statusEl.style.color = "#ef4444";
    } else if (result) {
      const { checked = 0, updated = 0 } = result;
      statusEl.textContent = `Done! ${updated} of ${checked} listings updated.`;
      statusEl.style.color = "#22c55e";
      loadSyncStatus();
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = "#ef4444";
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh All Linked Listings";
    setTimeout(() => { statusEl.style.display = "none"; }, 5000);
  }
});

// ─── Sync Current Page ───
$("#sync-btn").addEventListener("click", async () => {
  $("#sync-btn").disabled = true;
  $("#sync-btn").textContent = "Syncing...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    const results = await chrome.tabs.sendMessage(tab.id, { action: "scrape_page" });
    if (!results || !results.listings || results.listings.length === 0) {
      throw new Error("No listings found on this page. Make sure you're on your closet/shop page.");
    }

    addLog(`Found ${results.listings.length} listings on ${results.platform}`);
    const stats = await syncListings(results.listings, results.platform);

    $("#synced-count").textContent = stats.synced;
    $("#new-count").textContent = stats.created;
    await chrome.storage.local.set({ reflip_stats: stats });

    addLog(`Done! ${stats.linked || 0} linked, ${stats.created} unmatched`, "ok");
  } catch (e) {
    addLog(`Error: ${e.message}`, "err");
  } finally {
    $("#sync-btn").disabled = false;
    $("#sync-btn").textContent = "Link & Sync This Page";
  }
});

// ─── Sync All ───
$("#sync-all-btn").addEventListener("click", async () => {
  $("#sync-all-btn").disabled = true;
  $("#sync-all-btn").textContent = "Linking...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    const results = await chrome.tabs.sendMessage(tab.id, { action: "scrape_all" });
    if (!results || !results.listings || results.listings.length === 0) {
      throw new Error("No listings found. Navigate to your closet/shop page first.");
    }

    addLog(`Found ${results.listings.length} total listings on ${results.platform}`);
    const stats = await syncListings(results.listings, results.platform);

    $("#synced-count").textContent = stats.synced;
    $("#new-count").textContent = stats.created;
    await chrome.storage.local.set({ reflip_stats: stats });

    addLog(`Done! ${stats.linked || 0} linked, ${stats.created} unmatched`, "ok");
  } catch (e) {
    addLog(`Error: ${e.message}`, "err");
  } finally {
    $("#sync-all-btn").disabled = false;
    $("#sync-all-btn").textContent = "Link All My Listings";
  }
});

// ─── Sync logic: LINK platform listings to existing ReFlip listings ───
async function syncListings(listings, platform) {
  // Get ALL existing listings from ReFlip (not filtered by platform)
  const res = await fetch(`${config.serverUrl}/api/listings`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) throw new Error("Could not fetch existing listings");
  const existing = await res.json();

  const platformUrlField = `${platform}Url`; // depopUrl, vintedUrl, ebayUrl
  let linked = 0;
  let updated = 0;
  let skipped = 0;

  // Pre-compute all text for existing listings (title + description + brand)
  const existingIndex = existing.map((e) => ({
    listing: e,
    words: normalizeText(`${e.title || ""} ${e.description || ""} ${e.brand || ""}`),
    brand: (e.brand || "").toLowerCase().trim(),
    size: (e.size || "").toLowerCase().trim(),
    price: e.listedPrice || 0,
  }));

  for (const item of listings) {
    try {
      // 1) Exact match by platform URL (already linked)
      let match = existing.find(
        (e) => e[platformUrlField] && e[platformUrlField] === item.url
      );

      // 2) Smart match using multiple signals
      if (!match) {
        const itemWords = normalizeText(`${item.title || ""} ${item.description || ""} ${item.brand || ""}`);
        const itemBrand = (item.brand || "").toLowerCase().trim();
        const itemSize = (item.size || "").toLowerCase().trim();
        const itemPrice = item.price || 0;

        let bestScore = 0;
        let bestMatch = null;

        for (const ei of existingIndex) {
          // Skip if already linked to this platform
          if (ei.listing[platformUrlField]) continue;

          let score = 0;

          // Word overlap (title + description + brand combined)
          const wordScore = wordOverlap(itemWords, ei.words);
          score += wordScore * 0.5;

          // Brand match bonus
          if (itemBrand && ei.brand && (
            itemBrand.includes(ei.brand) || ei.brand.includes(itemBrand)
          )) {
            score += 0.25;
          }

          // Size match bonus
          if (itemSize && ei.size && itemSize === ei.size) {
            score += 0.15;
          }

          // Price proximity bonus (within 30%)
          if (itemPrice > 0 && ei.price > 0) {
            const priceDiff = Math.abs(itemPrice - ei.price) / Math.max(itemPrice, ei.price);
            if (priceDiff < 0.3) score += 0.1 * (1 - priceDiff);
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = ei.listing;
          }
        }

        // Threshold: 0.25 is enough if brand+size+price match
        if (bestScore >= 0.25 && bestMatch) {
          match = bestMatch;
          addLog(`Match (${(bestScore * 100).toFixed(0)}%): "${item.title?.slice(0, 30)}" → "${match.title?.slice(0, 30)}"`, "ok");
        }
      }

      if (match) {
        // Link & update existing listing with platform data
        const updates = {};

        // Always link the platform URL
        if (item.url && !match[platformUrlField]) {
          updates[platformUrlField] = item.url;
        }

        // Always update price from the live platform (it's the source of truth)
        if (item.price && item.price > 0 && item.price !== match.listedPrice) {
          updates.listedPrice = item.price;
        }

        // Always update description from live (user may have tweaked it on the platform)
        if (item.description && item.description.length > 10) {
          updates.description = item.description;
        }

        // Update title if listing has none
        if (item.title && item.title.length > 2 && (!match.title || match.title.length < 3)) {
          updates.title = item.title;
        }

        // Update brand if listing has none
        if (item.brand && !match.brand) {
          updates.brand = item.brand;
        }

        // Update size if listing has none
        if (item.size && !match.size) {
          updates.size = item.size;
        }

        // Update condition if listing has none
        if (item.condition && !match.condition) {
          updates.condition = item.condition;
        }

        // Update images if listing has none or only thumbnails
        if (item.images && item.images.length > 0) {
          const existingImages = parseImages(match.imageUrl);
          if (existingImages.length === 0 || containsThumbnails(existingImages)) {
            updates.imageUrl = JSON.stringify(item.images);
          }
        }

        // Update status if sold
        if (item.status === "sold" && match.status === "active") {
          updates.status = "sold";
        }

        if (Object.keys(updates).length > 0) {
          const res = await fetch(`${config.serverUrl}/api/listings/${match.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.token}`,
            },
            body: JSON.stringify(updates),
          });
          if (!res.ok) {
            addLog(`Failed to update "${match.title?.slice(0, 25)}": ${res.status}`, "err");
          } else {
            const fields = Object.keys(updates).filter(k => k !== platformUrlField);
            if (fields.length > 0) {
              addLog(`Updated "${match.title?.slice(0, 25)}": ${fields.join(", ")}`, "ok");
            }
          }
          linked++;
        } else {
          updated++;
        }
      } else {
        addLog(`No match: "${item.title?.slice(0, 40)}" $${item.price}`, "err");
        skipped++;
      }
    } catch (e) {
      addLog(`Error: ${item.title?.slice(0, 30)} — ${e.message}`, "err");
    }
  }

  return { synced: linked + updated, created: skipped, linked };
}

function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "your", "have",
  "are", "was", "were", "been", "has", "its", "very", "new", "like",
  "just", "get", "got", "item", "listed", "listing", "size", "color",
  "condition", "great", "good", "excellent", "brand", "free", "shipping",
  "offers", "offer", "welcome", "worn", "never", "once", "times",
]);

function wordOverlap(words1, words2) {
  if (words1.length === 0 || words2.length === 0) return 0;
  const set2 = new Set(words2);
  const matches = words1.filter((w) => set2.has(w)).length;
  // Use min length so partial overlaps score higher
  return matches / Math.min(words1.length, words2.length);
}

function titleSimilarity(words1, words2) {
  if (words1.length === 0 || words2.length === 0) return 0;
  const set2 = new Set(words2);
  const matches = words1.filter((w) => set2.has(w)).length;
  return matches / Math.max(words1.length, words2.length);
}

function parseImages(imageUrl) {
  if (!imageUrl) return [];
  try {
    const parsed = JSON.parse(imageUrl);
    return Array.isArray(parsed) ? parsed : [imageUrl];
  } catch {
    return imageUrl ? [imageUrl] : [];
  }
}

function containsThumbnails(urls) {
  return urls.some((u) => /w_\d{2,3}[^0-9]|\/thumb|_thumb|s_\d{2,3}[^0-9]/.test(u));
}

// ─── Log ───
const logEntries = [];

function addLog(msg, type) {
  const time = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  logEntries.unshift({ msg: `${time} ${msg}`, type });
  if (logEntries.length > 20) logEntries.pop();
  renderLog(logEntries);
  chrome.storage.local.set({ reflip_log: logEntries });
}

function renderLog(entries) {
  const el = $("#log");
  el.innerHTML = entries
    .map((e) => `<p class="${e.type || ""}">${e.msg}</p>`)
    .join("");
}
