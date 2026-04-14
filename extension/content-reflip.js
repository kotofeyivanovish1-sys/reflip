// ReFlip content script — runs on the ReFlip web app
// Acts as a bridge between the website UI and the extension background worker
// The page cannot call chrome.runtime directly — this script does it instead

(function () {
  // Tell the page that the ReFlip extension is installed
  window.dispatchEvent(new CustomEvent("reflip:extension-ready", {
    detail: { version: "1.1" },
  }));

  // Listen for sync requests from the page UI
  window.addEventListener("reflip:sync-request", async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: "sync_all_linked" });
      window.dispatchEvent(new CustomEvent("reflip:sync-done", { detail: result || {} }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("reflip:sync-done", { detail: { error: e.message } }));
    }
  });

  // Listen for status requests
  window.addEventListener("reflip:status-request", async () => {
    try {
      const status = await chrome.runtime.sendMessage({ action: "get_sync_status" });
      window.dispatchEvent(new CustomEvent("reflip:status-response", { detail: status || {} }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("reflip:status-response", { detail: {} }));
    }
  });

  // Proactively send status when page loads (so the UI can show last sync time on mount)
  setTimeout(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ action: "get_sync_status" });
      window.dispatchEvent(new CustomEvent("reflip:status-response", { detail: status || {} }));
    } catch {}
  }, 500);
})();
