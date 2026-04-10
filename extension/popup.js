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

  const platformUrlField = `${platform}Url`; // depopUrl, poshmarkUrl, etc.
  let linked = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of listings) {
    try {
      // 1) Exact match by platform URL (already linked)
      let match = existing.find(
        (e) => e[platformUrlField] && e[platformUrlField] === item.url
      );

      // 2) Fuzzy match by title
      if (!match && item.title) {
        const itemWords = normalizeTitle(item.title);
        let bestScore = 0;
        let bestMatch = null;

        for (const e of existing) {
          if (!e.title) continue;
          const score = titleSimilarity(itemWords, normalizeTitle(e.title));
          if (score > bestScore) {
            bestScore = score;
            bestMatch = e;
          }
        }
        // Need at least 40% word overlap to consider it a match
        if (bestScore >= 0.4) match = bestMatch;
      }

      if (match) {
        // Link & update existing listing
        const updates = {};

        // Always set platform URL
        if (item.url && !match[platformUrlField]) {
          updates[platformUrlField] = item.url;
        }

        // Update price if we have one and existing doesn't
        if (item.price && item.price > 0 && (!match.listedPrice || match.listedPrice === 0)) {
          updates.listedPrice = item.price;
        }

        // Update photos if better quality available
        if (item.images && item.images.length > 0) {
          const existingImages = parseImages(match.imageUrl);
          if (existingImages.length === 0 || containsThumbnails(existingImages)) {
            updates.imageUrl = JSON.stringify(item.images);
          }
        }

        // Sync sold status
        if (item.status === "sold" && match.status === "active") {
          updates.status = "sold";
        }

        if (Object.keys(updates).length > 0) {
          await fetch(`${config.serverUrl}/api/listings/${match.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.token}`,
            },
            body: JSON.stringify(updates),
          });
          const action = !match[platformUrlField] ? "Linked" : "Updated";
          addLog(`${action}: ${(match.title || item.title).slice(0, 45)}`, "ok");
          linked++;
        } else {
          updated++;
        }
      } else {
        // No match found — skip (don't create)
        addLog(`No match: "${item.title?.slice(0, 40)}" — $${item.price}`, "err");
        skipped++;
      }
    } catch (e) {
      addLog(`Error: ${item.title?.slice(0, 30)} — ${e.message}`, "err");
    }
  }

  return { synced: linked + updated, created: skipped, linked };
}

function normalizeTitle(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);
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
