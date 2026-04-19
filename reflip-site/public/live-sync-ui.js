(function () {
  const state = {
    liveViews: new Map(),
    engagements: new Map(),
    platformStats: null,
    pending: new Map(),
    renderQueued: false
  };

  const COPY_REPLACEMENTS = [
    ["Live Market Data", "Suggested Market Range"],
    [
      "Fetching live prices from eBay, Vinted, Depop, Poshmark...",
      "Estimating resale price ranges from saved comps across eBay, Vinted, Depop, and Poshmark..."
    ]
  ];

  function routePath() {
    const hash = window.location.hash || "#/";
    return hash.startsWith("#") ? hash.slice(1) : hash;
  }

  function isListingsRoute() {
    return routePath() === "/listings";
  }

  function isAnalyticsRoute() {
    return routePath() === "/analytics";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value) {
    return value == null ? "n/a" : new Intl.NumberFormat("en-US").format(Number(value));
  }

  function formatCurrency(value, currency = "USD") {
    if (value == null) return "n/a";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0
      }).format(Number(value));
    } catch {
      return `$${Number(value).toFixed(0)}`;
    }
  }

  function formatDateTime(value) {
    if (!value) return "unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function titleCase(value) {
    return String(value || "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const json = await response.json();
        message = json.error || message;
      } catch {}
      throw new Error(message);
    }

    return response.json();
  }

  function getCached(cache, key, ttlMs) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) return null;
    return entry.value;
  }

  async function loadWithCache(cacheName, key, url, { force = false, ttlMs = 20000, options } = {}) {
    const cache = state[cacheName];
    if (!force) {
      const cached = getCached(cache, key, ttlMs);
      if (cached) return cached;
    }

    const pendingKey = `${cacheName}:${key}`;
    if (state.pending.has(pendingKey) && !force) {
      return state.pending.get(pendingKey);
    }

    const promise = fetchJson(url, options)
      .then((value) => {
        cache.set(key, { value, timestamp: Date.now() });
        return value;
      })
      .finally(() => state.pending.delete(pendingKey));

    state.pending.set(pendingKey, promise);
    return promise;
  }

  function invalidateListingCaches(listingId) {
    state.liveViews.delete(String(listingId));
    state.engagements.delete(String(listingId));
    state.platformStats = null;
  }

  async function getLiveView(listingId, force = false) {
    return loadWithCache("liveViews", String(listingId), `/api/listings/${listingId}/live-view`, {
      force,
      ttlMs: 15000
    });
  }

  async function getEngagement(listingId, force = false) {
    return loadWithCache("engagements", String(listingId), `/api/listings/${listingId}/engagement?days=30`, {
      force,
      ttlMs: 15000
    });
  }

  async function getPlatformStats(force = false) {
    if (!force && state.platformStats && Date.now() - state.platformStats.timestamp < 15000) {
      return state.platformStats.value;
    }

    const value = await fetchJson("/api/stats/platforms");
    state.platformStats = { value, timestamp: Date.now() };
    return value;
  }

  function trendTotals(history, platform, days) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));

    return (history || []).reduce(
      (acc, entry) => {
        if (entry.platform !== platform) return acc;
        if (new Date(entry.date) < cutoff) return acc;
        acc.views += entry.metrics?.views ?? 0;
        acc.interest += entry.metrics?.interestCount ?? 0;
        return acc;
      },
      { views: 0, interest: 0 }
    );
  }

  function toneForChannel(channel, freshness) {
    if (channel.lastError) return "alert";
    if (freshness !== "fresh" || channel.metrics?.metricsFreshness === "stale") return "warn";
    return "ok";
  }

  function renderChannel(channel, liveView, engagement) {
    const history = engagement?.history ?? [];
    const trend7 = trendTotals(history, channel.platform, 7);
    const trend30 = trendTotals(history, channel.platform, 30);
    const divergences = (liveView?.divergences ?? []).filter((entry) => entry.platform === channel.platform);
    const freshnessEntry = (liveView?.freshness?.byPlatform ?? []).find((entry) => entry.platform === channel.platform);
    const tone = toneForChannel(channel, freshnessEntry?.liveFreshness);
    const rawMetrics = [
      channel.metrics?.clicks != null ? `Clicks ${formatNumber(channel.metrics.clicks)}` : null,
      channel.metrics?.favorites != null ? `Favorites ${formatNumber(channel.metrics.favorites)}` : null,
      channel.metrics?.likes != null ? `Likes ${formatNumber(channel.metrics.likes)}` : null,
      channel.metrics?.watchers != null ? `Watchers ${formatNumber(channel.metrics.watchers)}` : null,
      channel.metrics?.shares != null ? `Shares ${formatNumber(channel.metrics.shares)}` : null
    ]
      .filter(Boolean)
      .join(" · ");

    return `
      <article class="rf-live-channel">
        <div class="rf-live-channel__top">
          <div>
            <div class="rf-live-channel__name">${escapeHtml(titleCase(channel.platform))}</div>
            <div class="rf-live-channel__status">${escapeHtml(channel.liveStatus || "unknown")} status</div>
            <div class="rf-live-channel__badges">
              <span class="rf-live-badge" data-tone="${tone}">${escapeHtml(freshnessEntry?.liveFreshness || "unknown")}</span>
              <span class="rf-live-badge">${escapeHtml(channel.metrics?.metricsSource || channel.source || "manual")}</span>
              <span class="rf-live-badge">${escapeHtml(channel.externalListingId || "linked")}</span>
            </div>
          </div>
          <div class="rf-live-panel__actions">
            <button class="rf-live-panel__button" data-rf-action="refresh" data-listing-id="${escapeHtml(liveView.listing.id)}" data-platform="${escapeHtml(channel.platform)}">Refresh</button>
            <button class="rf-live-panel__button" data-rf-action="unlink" data-listing-id="${escapeHtml(liveView.listing.id)}" data-platform="${escapeHtml(channel.platform)}">Unlink</button>
          </div>
        </div>
        <div class="rf-live-channel__stats">
          <div class="rf-live-channel__stat">
            <span class="rf-live-channel__label">Views</span>
            <span class="rf-live-channel__value">${formatNumber(channel.metrics?.views)}</span>
          </div>
          <div class="rf-live-channel__stat">
            <span class="rf-live-channel__label">Interest</span>
            <span class="rf-live-channel__value">${formatNumber(channel.metrics?.interestCount)}</span>
          </div>
          <div class="rf-live-channel__stat">
            <span class="rf-live-channel__label">Live Price</span>
            <span class="rf-live-channel__value">${formatCurrency(channel.livePrice, channel.liveCurrency || "USD")}</span>
          </div>
          <div class="rf-live-channel__stat">
            <span class="rf-live-channel__label">30d Interest</span>
            <span class="rf-live-channel__value">${formatNumber(trend30.interest)}</span>
          </div>
        </div>
        <div class="rf-live-channel__meta">
          <span>7d: ${formatNumber(trend7.views)} views / ${formatNumber(trend7.interest)} interest</span>
          <span>30d: ${formatNumber(trend30.views)} views / ${formatNumber(trend30.interest)} interest</span>
          <span>Last seen: ${escapeHtml(formatDateTime(channel.lastSeenAt || channel.metrics?.capturedAt))}</span>
          ${channel.externalUrl ? `<span><a href="${escapeHtml(channel.externalUrl)}" target="_blank" rel="noreferrer">Open live listing</a></span>` : ""}
        </div>
        ${rawMetrics ? `<div class="rf-live-channel__meta"><span>${escapeHtml(rawMetrics)}</span></div>` : ""}
        ${divergences.length ? `<div class="rf-live-channel__diff">Diffs: ${escapeHtml(divergences.map((entry) => `${entry.field} differs from ReFlip`).join(" · "))}</div>` : ""}
        ${channel.lastError ? `<div class="rf-live-panel__error">${escapeHtml(channel.lastError)}</div>` : ""}
      </article>
    `;
  }

  function renderLivePanel(liveView, engagement) {
    const channels = liveView?.channels ?? [];
    const bestPrice = liveView?.bestCurrentLivePrice != null
      ? formatCurrency(liveView.bestCurrentLivePrice, channels[0]?.liveCurrency || "USD")
      : "n/a";

    if (!channels.length) {
      return `
        <div class="rf-live-panel__header">
          <div>
            <div class="rf-live-panel__title">Live Sync & Stats</div>
            <div class="rf-live-panel__subtle">Link a live marketplace URL so ReFlip can read real listing state and attention signals.</div>
          </div>
          <div class="rf-live-panel__actions">
            <button class="rf-live-panel__button rf-live-panel__button--primary" data-rf-action="attach" data-listing-id="${escapeHtml(liveView.listing.id)}">Attach Live URL</button>
          </div>
        </div>
        <div class="rf-live-panel__empty">
          <div class="rf-live-panel__message">No live channels linked yet. Attach an eBay, Depop, or Vinted listing URL to start tracking views, saves, likes, and freshness.</div>
        </div>
      `;
    }

    return `
      <div class="rf-live-panel__header">
        <div>
          <div class="rf-live-panel__title">Live Sync & Stats</div>
          <div class="rf-live-panel__subtle">Best current live price: ${escapeHtml(bestPrice)} · Total views ${formatNumber(liveView.engagementSummary?.totalViews)} · Total interest ${formatNumber(liveView.engagementSummary?.totalInterest)}</div>
        </div>
        <div class="rf-live-panel__actions">
          <button class="rf-live-panel__button rf-live-panel__button--primary" data-rf-action="attach" data-listing-id="${escapeHtml(liveView.listing.id)}">Attach Another URL</button>
        </div>
      </div>
      <div class="rf-live-panel__grid">
        ${channels.map((channel) => renderChannel(channel, liveView, engagement)).join("")}
      </div>
    `;
  }

  async function mountListingPanel(card) {
    const testId = card.getAttribute("data-testid") || "";
    const match = testId.match(/listing-card-(\d+)/);
    if (!match) return;

    const listingId = match[1];
    let panel = card.querySelector(".rf-live-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "rf-live-panel";
      panel.dataset.listingId = listingId;
      panel.innerHTML = `<div class="rf-live-panel__loading">Loading live sync…</div>`;
      (card.firstElementChild || card).appendChild(panel);
    }

    if (panel.dataset.loading === "1") return;
    panel.dataset.loading = "1";
    panel.innerHTML = `<div class="rf-live-panel__loading">Loading live sync…</div>`;

    try {
      const [liveView, engagement] = await Promise.all([getLiveView(listingId), getEngagement(listingId)]);
      if (!panel.isConnected) return;
      panel.innerHTML = renderLivePanel(liveView, engagement);
    } catch (error) {
      if (!panel.isConnected) return;
      panel.innerHTML = `
        <div class="rf-live-panel__header">
          <div>
            <div class="rf-live-panel__title">Live Sync & Stats</div>
            <div class="rf-live-panel__subtle">We could not load the current live marketplace snapshot.</div>
          </div>
          <div class="rf-live-panel__actions">
            <button class="rf-live-panel__button rf-live-panel__button--primary" data-rf-action="attach" data-listing-id="${escapeHtml(listingId)}">Attach Live URL</button>
          </div>
        </div>
        <div class="rf-live-panel__error">${escapeHtml(error.message)}</div>
      `;
    } finally {
      panel.dataset.loading = "0";
    }
  }

  async function mountAnalyticsPanel() {
    const main = document.querySelector("main");
    if (!main) return;

    let panel = document.getElementById("rf-analytics-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "rf-analytics-panel";
      panel.className = "rf-analytics-panel";
      main.prepend(panel);
    }

    panel.innerHTML = `<div class="rf-live-panel__loading">Loading engagement rollups…</div>`;

    try {
      const stats = await getPlatformStats();
      if (!panel.isConnected) return;
      const rows = stats.filter(
        (entry) => entry.linkedChannels || entry.totalViews || entry.totalInterest || entry.staleChannelCount
      );

      panel.innerHTML = `
        <div class="rf-analytics-panel__header">
          <div>
            <div class="rf-analytics-panel__title">Live Engagement Rollup</div>
            <div class="rf-analytics-panel__subtle">Views and save-style interest across linked live channels.</div>
          </div>
        </div>
        <div class="rf-analytics-panel__grid">
          ${rows.length
            ? rows
                .map(
                  (entry) => `
                    <article class="rf-analytics-card">
                      <div class="rf-analytics-card__name">${escapeHtml(titleCase(entry.platform))}</div>
                      <div class="rf-live-panel__grid">
                        <div class="rf-analytics-stat">
                          <span class="rf-analytics-stat__label">Views</span>
                          <span class="rf-analytics-stat__value">${formatNumber(entry.totalViews)}</span>
                        </div>
                        <div class="rf-analytics-stat">
                          <span class="rf-analytics-stat__label">Interest</span>
                          <span class="rf-analytics-stat__value">${formatNumber(entry.totalInterest)}</span>
                        </div>
                        <div class="rf-analytics-stat">
                          <span class="rf-analytics-stat__label">Avg Interest / Active</span>
                          <span class="rf-analytics-stat__value">${formatNumber(entry.avgInterestPerActiveListing)}</span>
                        </div>
                        <div class="rf-analytics-stat">
                          <span class="rf-analytics-stat__label">Stale Channels</span>
                          <span class="rf-analytics-stat__value">${formatNumber(entry.staleChannelCount)}</span>
                        </div>
                      </div>
                    </article>
                  `
                )
                .join("")
            : `<div class="rf-live-panel__empty"><div class="rf-live-panel__message">No linked live channels yet. Once you attach listings, platform engagement totals will show up here.</div></div>`}
        </div>
      `;
    } catch (error) {
      panel.innerHTML = `<div class="rf-live-panel__error">${escapeHtml(error.message)}</div>`;
    }
  }

  function applyCopyFixes() {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      for (const [from, to] of COPY_REPLACEMENTS) {
        if (node.nodeValue && node.nodeValue.includes(from)) {
          node.nodeValue = node.nodeValue.replaceAll(from, to);
        }
      }
    }
  }

  async function handleAction(event) {
    const button = event.target.closest("[data-rf-action]");
    if (!button) return;

    const action = button.getAttribute("data-rf-action");
    const listingId = button.getAttribute("data-listing-id");
    const platform = button.getAttribute("data-platform");

    if (!listingId) return;
    button.disabled = true;

    try {
      if (action === "attach") {
        const url = window.prompt("Paste the live marketplace URL for this listing.");
        if (!url) return;
        await fetchJson(`/api/listings/${listingId}/channels/attach`, {
          method: "POST",
          body: JSON.stringify({ url })
        });
      }

      if (action === "refresh" && platform) {
        await fetchJson(`/api/listings/${listingId}/channels/${platform}/refresh`, {
          method: "POST"
        });
      }

      if (action === "unlink" && platform) {
        const confirmed = window.confirm(`Unlink ${titleCase(platform)} from this ReFlip listing?`);
        if (!confirmed) return;
        await fetchJson(`/api/listings/${listingId}/channels/${platform}`, {
          method: "DELETE"
        });
      }

      invalidateListingCaches(listingId);
      queueRender();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    window.requestAnimationFrame(async () => {
      state.renderQueued = false;
      applyCopyFixes();

      if (isListingsRoute()) {
        const cards = document.querySelectorAll('[data-testid^="listing-card-"]');
        for (const card of cards) {
          await mountListingPanel(card);
        }
      }

      if (isAnalyticsRoute()) {
        await mountAnalyticsPanel();
      }
    });
  }

  document.addEventListener("click", handleAction);
  window.addEventListener("hashchange", queueRender);
  window.addEventListener("load", queueRender);

  const observer = new MutationObserver(() => queueRender());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  queueRender();
})();
