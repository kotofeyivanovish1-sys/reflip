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

    addLog(`Done! ${stats.synced} synced, ${stats.created} new`, "ok");
  } catch (e) {
    addLog(`Error: ${e.message}`, "err");
  } finally {
    $("#sync-btn").disabled = false;
    $("#sync-btn").textContent = "Sync This Page";
  }
});

// ─── Sync All (sends message to content script to navigate) ───
$("#sync-all-btn").addEventListener("click", async () => {
  $("#sync-all-btn").disabled = true;
  $("#sync-all-btn").textContent = "Syncing all...";

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

    addLog(`Done! ${stats.synced} synced, ${stats.created} new`, "ok");
  } catch (e) {
    addLog(`Error: ${e.message}`, "err");
  } finally {
    $("#sync-all-btn").disabled = false;
    $("#sync-all-btn").textContent = "Sync All My Listings";
  }
});

// ─── Sync logic: send scraped listings to ReFlip API ───
async function syncListings(listings, platform) {
  // Get existing listings from ReFlip
  const res = await fetch(`${config.serverUrl}/api/listings?platform=${platform}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) throw new Error("Could not fetch existing listings");
  const existing = await res.json();

  const platformUrlField = `${platform}Url`; // depopUrl, poshmarkUrl, etc.
  let synced = 0;
  let created = 0;

  for (const item of listings) {
    try {
      // Check if listing already exists (match by platform URL or title)
      const match = existing.find(
        (e) => (e[platformUrlField] && e[platformUrlField] === item.url) ||
               (e.title && e.title.toLowerCase() === item.title.toLowerCase())
      );

      if (match) {
        // Update existing listing — sync price, status, photos
        const updates = {};
        if (item.price && item.price !== match.listedPrice) updates.listedPrice = item.price;
        if (item.status && item.status !== match.status) updates.status = item.status;
        if (item.url && !match[platformUrlField]) updates[platformUrlField] = item.url;
        if (item.images && item.images.length > 0 && !match.imageUrl) {
          updates.imageUrl = JSON.stringify(item.images);
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
          addLog(`Updated: ${item.title.slice(0, 40)}...`);
        }
        synced++;
      } else {
        // Create new listing
        const body = {
          title: item.title,
          description: item.description || item.title,
          brand: item.brand || null,
          size: item.size || null,
          condition: item.condition || "good",
          platform,
          status: item.status || "active",
          listedPrice: item.price || 0,
          costPrice: 0,
          imageUrl: item.images?.length > 0 ? JSON.stringify(item.images) : null,
          [platformUrlField]: item.url,
        };

        await fetch(`${config.serverUrl}/api/listings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify(body),
        });
        addLog(`New: ${item.title.slice(0, 40)}...`, "ok");
        created++;
        synced++;
      }
    } catch (e) {
      addLog(`Failed: ${item.title?.slice(0, 30)} — ${e.message}`, "err");
    }
  }

  return { synced, created };
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
