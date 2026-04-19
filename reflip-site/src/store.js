import fs from "node:fs";
import path from "node:path";
import {
  buildDivergences,
  canonicalizeExternalUrl,
  channelFreshness,
  mergeChannelSnapshot,
  METRIC_KEYS,
  normalizeChannel,
  normalizeMetrics,
  summarizeEngagement
} from "./liveSync.js";

const DEFAULT_PLATFORMS = ["depop", "vinted", "poshmark", "ebay"];

function monthLabel(date) {
  return date.toLocaleString("en-US", { month: "short" });
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isoDate(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function dayKey(value = new Date().toISOString()) {
  return isoDate(value, new Date().toISOString())?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
}

function toJsonString(value, fallback = {}) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? fallback);
}

function makeSeedListing(overrides) {
  return {
    id: 0,
    title: "",
    description: "",
    brand: null,
    size: null,
    condition: "good",
    category: null,
    costPrice: 0,
    listedPrice: null,
    soldPrice: null,
    soldAt: null,
    createdAt: new Date().toISOString(),
    platform: "depop",
    status: "pending",
    bagNumber: null,
    priceSuggestions: JSON.stringify({}),
    aiTexts: null,
    scanData: null,
    channels: [],
    ...overrides
  };
}

function createSeedData() {
  const now = new Date();
  const soldDate = new Date(now);
  soldDate.setDate(Math.max(1, soldDate.getDate() - 10));

  const scanHistory = [
    {
      id: 1,
      query: "Patagonia fleece",
      analysis: JSON.stringify({
        itemName: "Patagonia Synchilla Fleece",
        brand: "Patagonia",
        category: "Outerwear",
        era: "2010s",
        sellScore: 8,
        trendScore: 7,
        profitabilityRating: "high",
        recommendation: "Strong flip. Patagonia fleece keeps moving quickly on resale apps.",
        estimatedProfit: { low: 28, high: 44 },
        buyAt: { ideal: 12, max: 20 },
        sellingPoints: ["Recognizable outdoor brand", "Easy to photograph", "Great year-round demand"],
        checkFor: ["Pilling on cuffs", "Broken zipper teeth", "Stains inside collar"],
        platforms: {
          depop: { minPrice: 42, maxPrice: 56, score: 8, reason: "Lifestyle buyers pay more for clean outdoor fleece." },
          vinted: { minPrice: 32, maxPrice: 45, score: 6, reason: "Fast mover if priced below market." },
          poshmark: { minPrice: 38, maxPrice: 52, score: 7, reason: "Bundle-friendly audience." },
          ebay: { minPrice: 35, maxPrice: 49, score: 7, reason: "Steady nationwide demand." }
        }
      }),
      createdAt: soldDate.toISOString()
    }
  ];

  const listings = [
    makeSeedListing({
      id: 1,
      title: "Patagonia Synchilla Fleece",
      description: "Blue quarter-zip fleece in great condition. Soft, cozy, and easy to crosslist.",
      brand: "Patagonia",
      size: "M",
      category: "Outerwear",
      costPrice: 12,
      listedPrice: 54,
      soldPrice: 48,
      soldAt: soldDate.toISOString().slice(0, 10),
      createdAt: soldDate.toISOString(),
      platform: "depop",
      status: "sold",
      bagNumber: 1,
      priceSuggestions: JSON.stringify({ depop: 54, vinted: 42, poshmark: 48, ebay: 45 }),
      scanData: scanHistory[0].analysis
    }),
    makeSeedListing({
      id: 2,
      title: "Coach Shoulder Bag",
      description: "COACH tan shoulder bag 🤍\nClassic neutral carryall with clean interior and easy daily styling.\n\nOpen to offers 📩",
      brand: "Coach",
      size: null,
      category: "Bag",
      costPrice: 18,
      listedPrice: 72,
      createdAt: now.toISOString(),
      platform: "poshmark",
      status: "active",
      bagNumber: 2,
      priceSuggestions: JSON.stringify({ depop: 68, vinted: 58, poshmark: 72, ebay: 64 }),
      aiTexts: JSON.stringify({
        depop: "Coach Tan Shoulder Bag|COACH tan shoulder bag 🤍\nClassic neutral carryall with clean interior and easy daily styling.\n\nOpen to offers 📩",
        vinted: "Coach Tan Shoulder Bag|COACH tan shoulder bag 🤍\nClean interior, everyday neutral bag.\n\nOpen to offers 📩",
        poshmark: "Coach Tan Shoulder Bag|COACH tan shoulder bag 🤍\nBundle-friendly neutral bag with clean interior.\n\nOpen to offers 📩",
        ebay: "Coach Tan Shoulder Bag|Coach Tan Shoulder Bag\nClassic neutral shoulder bag with clean interior and solid resale appeal."
      })
    }),
    makeSeedListing({
      id: 3,
      title: "Vintage Levi's Denim Jacket",
      description: "Medium wash trucker jacket. Great layering piece with strong vintage appeal.",
      brand: "Levi's",
      size: "L",
      category: "Jacket",
      costPrice: 10,
      listedPrice: 60,
      createdAt: now.toISOString(),
      platform: "ebay",
      status: "pending",
      bagNumber: 3,
      priceSuggestions: JSON.stringify({ depop: 62, vinted: 46, poshmark: 58, ebay: 60 }),
      aiTexts: JSON.stringify({
        depop: "Vintage Levi's Denim Jacket|LEVI'S denim jacket 🤍\nVintage wash layering piece with clean classic fit.\n\nOpen to offers 📩"
      })
    })
  ];

  return {
    meta: {
      nextListingId: 4,
      nextBagNumber: 4,
      nextScanId: 2
    },
    listings,
    scanHistory,
    channelMetricHistory: []
  };
}

function dedupeChannels(channels = []) {
  const byPlatform = new Map();

  for (const channel of channels) {
    const normalized = normalizeChannel(channel);
    if (!normalized.platform) continue;
    byPlatform.set(normalized.platform, normalized);
  }

  return [...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

function normalizeListingRecord(listing = {}) {
  return {
    ...makeSeedListing({}),
    ...listing,
    id: toNumber(listing.id, 0),
    costPrice: toNumber(listing.costPrice, 0),
    listedPrice: listing.listedPrice == null || listing.listedPrice === "" ? null : toNumber(listing.listedPrice, null),
    soldPrice: listing.soldPrice == null || listing.soldPrice === "" ? null : toNumber(listing.soldPrice, null),
    soldAt: listing.soldAt ?? null,
    createdAt: isoDate(listing.createdAt, new Date().toISOString()),
    priceSuggestions: toJsonString(listing.priceSuggestions, {}),
    aiTexts: listing.aiTexts == null ? null : toJsonString(listing.aiTexts, {}),
    scanData: listing.scanData == null ? null : typeof listing.scanData === "string" ? listing.scanData : JSON.stringify(listing.scanData),
    channels: dedupeChannels(Array.isArray(listing.channels) ? listing.channels : [])
  };
}

function hasMetricValue(metrics) {
  return [...METRIC_KEYS, "interestCount"].some((key) => metrics?.[key] != null);
}

function normalizeHistoryEntry(entry = {}) {
  const metrics = normalizeMetrics(entry.metrics, {
    source: entry.source ?? entry.metrics?.metricsSource ?? "manual",
    capturedAt: entry.capturedAt ?? entry.metrics?.capturedAt ?? null
  });

  return {
    listingId: toNumber(entry.listingId, 0),
    platform: entry.platform ?? null,
    date: entry.date ?? dayKey(entry.capturedAt ?? entry.metrics?.capturedAt),
    metrics,
    source: entry.source ?? metrics.metricsSource ?? "manual",
    capturedAt: isoDate(entry.capturedAt ?? metrics.capturedAt, metrics.capturedAt)
  };
}

function normalizeData(data = {}) {
  const base = createSeedData();
  const listings = Array.isArray(data.listings) ? data.listings.map(normalizeListingRecord) : base.listings;
  const scanHistory = Array.isArray(data.scanHistory) ? data.scanHistory : base.scanHistory;
  const channelMetricHistory = Array.isArray(data.channelMetricHistory)
    ? data.channelMetricHistory
        .map(normalizeHistoryEntry)
        .filter((entry) => entry.listingId && entry.platform)
    : [];

  return {
    meta: {
      nextListingId: Math.max(
        toNumber(data.meta?.nextListingId, 1),
        listings.reduce((max, listing) => Math.max(max, listing.id), 0) + 1
      ),
      nextBagNumber: Math.max(
        toNumber(data.meta?.nextBagNumber, 1),
        listings.reduce((max, listing) => Math.max(max, toNumber(listing.bagNumber, 0)), 0) + 1
      ),
      nextScanId: Math.max(
        toNumber(data.meta?.nextScanId, 1),
        scanHistory.reduce((max, item) => Math.max(max, toNumber(item.id, 0)), 0) + 1
      )
    },
    listings,
    scanHistory,
    channelMetricHistory
  };
}

function mergeHistoryMetrics(previousMetrics = {}, nextMetrics = {}, source, capturedAt) {
  const merged = { ...previousMetrics };
  for (const key of [...METRIC_KEYS, "interestCount"]) {
    if (nextMetrics[key] != null) {
      merged[key] = nextMetrics[key];
    } else if (!(key in merged)) {
      merged[key] = null;
    }
  }
  merged.metricsSource = source ?? nextMetrics.metricsSource ?? previousMetrics.metricsSource ?? "manual";
  merged.capturedAt = isoDate(capturedAt ?? nextMetrics.capturedAt ?? previousMetrics.capturedAt, null);
  merged.metricsFreshness = nextMetrics.metricsFreshness ?? previousMetrics.metricsFreshness ?? "unknown";
  return merged;
}

function trendSummary(history, days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  const byPlatform = new Map();
  for (const entry of history) {
    const entryDate = new Date(entry.date);
    if (entryDate < cutoff) continue;
    const current = byPlatform.get(entry.platform) ?? {
      platform: entry.platform,
      daysTracked: 0,
      views: 0,
      interestCount: 0,
      latestDate: null
    };
    current.daysTracked += 1;
    current.views += entry.metrics?.views ?? 0;
    current.interestCount += entry.metrics?.interestCount ?? 0;
    current.latestDate = current.latestDate && current.latestDate > entry.date ? current.latestDate : entry.date;
    byPlatform.set(entry.platform, current);
  }

  return [...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

export class DataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureFile();
  }

  ensureFile() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.write(createSeedData());
    }
  }

  read() {
    const rawText = fs.readFileSync(this.filePath, "utf8");
    const rawData = JSON.parse(rawText);
    const normalized = normalizeData(rawData);
    const normalizedText = JSON.stringify(normalized, null, 2);

    if (rawText.trim() !== normalizedText.trim()) {
      fs.writeFileSync(this.filePath, normalizedText);
    }

    return normalized;
  }

  write(data) {
    const normalized = normalizeData(data);
    fs.writeFileSync(this.filePath, JSON.stringify(normalized, null, 2));
  }

  update(mutator) {
    const data = this.read();
    const result = normalizeData(mutator(data) ?? data);
    this.write(result);
    return result;
  }

  listListings(filters = {}) {
    const { status, platform } = filters;
    return this.read().listings
      .filter((listing) => (status && status !== "all" ? listing.status === status : true))
      .filter((listing) => (platform && platform !== "all" ? listing.platform === platform : true))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getListing(id) {
    return this.read().listings.find((listing) => listing.id === Number(id)) ?? null;
  }

  createListing(input) {
    let created;
    this.update((data) => {
      const listing = normalizeListingRecord({
        id: data.meta.nextListingId++,
        title: input.title ?? "Untitled listing",
        description: input.description ?? "—",
        brand: input.brand ?? null,
        size: input.size ?? null,
        condition: input.condition ?? "good",
        category: input.category ?? null,
        costPrice: Number(input.costPrice ?? 0),
        listedPrice: input.listedPrice == null ? null : Number(input.listedPrice),
        soldPrice: input.soldPrice == null ? null : Number(input.soldPrice),
        soldAt: input.soldAt ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
        platform: input.platform ?? "depop",
        status: input.status ?? "pending",
        bagNumber: data.meta.nextBagNumber++,
        priceSuggestions: input.priceSuggestions ?? JSON.stringify({}),
        aiTexts: input.aiTexts ?? null,
        scanData: input.scanData ?? null,
        channels: []
      });
      data.listings.push(listing);
      created = listing;
      return data;
    });
    return created;
  }

  updateListing(id, patch) {
    let updated = null;
    this.update((data) => {
      const listing = data.listings.find((item) => item.id === Number(id));
      if (!listing) {
        return data;
      }

      Object.assign(listing, patch);
      if (patch.costPrice != null) listing.costPrice = Number(patch.costPrice);
      if (patch.listedPrice != null) listing.listedPrice = Number(patch.listedPrice);
      if (patch.soldPrice != null) listing.soldPrice = Number(patch.soldPrice);
      listing.channels = dedupeChannels(listing.channels);
      updated = normalizeListingRecord(listing);
      Object.assign(listing, updated);
      return data;
    });
    return updated;
  }

  deleteListing(id) {
    let deleted = null;
    this.update((data) => {
      const index = data.listings.findIndex((item) => item.id === Number(id));
      if (index === -1) {
        return data;
      }
      deleted = data.listings[index];
      data.listings.splice(index, 1);
      data.channelMetricHistory = data.channelMetricHistory.filter((entry) => entry.listingId !== Number(id));
      return data;
    });
    return deleted;
  }

  attachChannel(listingId, channelInput) {
    let attached = null;

    this.update((data) => {
      const listing = data.listings.find((item) => item.id === Number(listingId));
      if (!listing) return data;

      const existing = listing.channels.find((channel) => channel.platform === channelInput.platform);
      const merged = mergeChannelSnapshot(existing, {
        platform: channelInput.platform,
        externalUrl: channelInput.externalUrl,
        externalListingId: channelInput.externalListingId,
        source: channelInput.source ?? "manual",
        confidence: channelInput.confidence ?? (existing ? existing.confidence : 72),
        lastError: null
      });

      const index = listing.channels.findIndex((channel) => channel.platform === merged.platform);
      if (index === -1) {
        listing.channels.push(merged);
      } else {
        listing.channels[index] = merged;
      }

      listing.channels = dedupeChannels(listing.channels);
      attached = listing.channels.find((channel) => channel.platform === merged.platform) ?? null;
      return data;
    });

    return attached;
  }

  updateChannel(listingId, platform, patch) {
    let updated = null;

    this.update((data) => {
      const listing = data.listings.find((item) => item.id === Number(listingId));
      if (!listing) return data;

      const index = listing.channels.findIndex((channel) => channel.platform === platform);
      if (index === -1) return data;

      const nextChannel = mergeChannelSnapshot(listing.channels[index], patch);
      listing.channels[index] = nextChannel;
      listing.channels = dedupeChannels(listing.channels);
      updated = listing.channels.find((channel) => channel.platform === platform) ?? null;
      return data;
    });

    return updated;
  }

  deleteChannel(listingId, platform) {
    let deleted = null;

    this.update((data) => {
      const listing = data.listings.find((item) => item.id === Number(listingId));
      if (!listing) return data;

      const index = listing.channels.findIndex((channel) => channel.platform === platform);
      if (index === -1) return data;

      deleted = listing.channels[index];
      listing.channels.splice(index, 1);
      return data;
    });

    return deleted;
  }

  findListingByExternal(platform, externalListingId, externalUrl) {
    const canonicalUrl = canonicalizeExternalUrl(externalUrl);

    for (const listing of this.read().listings) {
      const match = listing.channels.find((channel) => {
        if (channel.platform !== platform) return false;
        if (externalListingId && channel.externalListingId === externalListingId) return true;
        return canonicalUrl && canonicalUrl === channel.externalUrl;
      });

      if (match) {
        return { listing, channel: match };
      }
    }

    return null;
  }

  recordChannelMetricsHistory(listingId, platform, metrics, source, capturedAt) {
    const normalizedMetrics = normalizeMetrics(metrics, {
      source: source ?? metrics?.metricsSource ?? "manual",
      capturedAt: capturedAt ?? metrics?.capturedAt ?? null
    });

    if (!hasMetricValue(normalizedMetrics)) {
      return null;
    }

    let recorded = null;

    this.update((data) => {
      const date = dayKey(capturedAt ?? normalizedMetrics.capturedAt);
      const existing = data.channelMetricHistory.find(
        (entry) => entry.listingId === Number(listingId) && entry.platform === platform && entry.date === date
      );

      if (existing) {
        existing.metrics = mergeHistoryMetrics(existing.metrics, normalizedMetrics, source, capturedAt);
        existing.source = source ?? normalizedMetrics.metricsSource ?? existing.source;
        existing.capturedAt = isoDate(capturedAt ?? normalizedMetrics.capturedAt, existing.capturedAt);
        recorded = normalizeHistoryEntry(existing);
      } else {
        const created = normalizeHistoryEntry({
          listingId: Number(listingId),
          platform,
          date,
          metrics: normalizedMetrics,
          source: source ?? normalizedMetrics.metricsSource ?? "manual",
          capturedAt: capturedAt ?? normalizedMetrics.capturedAt
        });
        data.channelMetricHistory.push(created);
        recorded = created;
      }

      data.channelMetricHistory.sort((a, b) => {
        if (a.date === b.date) {
          return a.platform.localeCompare(b.platform);
        }
        return a.date.localeCompare(b.date);
      });

      return data;
    });

    return recorded;
  }

  applyLiveSnapshot(snapshot) {
    const match = this.findListingByExternal(snapshot.platform, snapshot.externalListingId, snapshot.externalUrl);
    if (!match) return null;

    const updated = this.updateChannel(match.listing.id, snapshot.platform, {
      externalUrl: snapshot.externalUrl ?? match.channel.externalUrl,
      externalListingId: snapshot.externalListingId ?? match.channel.externalListingId,
      liveTitle: snapshot.liveTitle,
      liveDescription: snapshot.liveDescription,
      livePrice: snapshot.livePrice,
      liveCurrency: snapshot.liveCurrency,
      liveStatus: snapshot.liveStatus,
      lastSeenAt: snapshot.capturedAt ?? new Date().toISOString(),
      lastRefreshAttemptAt: snapshot.capturedAt ?? new Date().toISOString(),
      source: snapshot.source ?? "extension",
      confidence: snapshot.confidence ?? 90,
      lastError: null,
      metrics: snapshot.metrics,
      capturedAt: snapshot.capturedAt
    });

    if (updated?.metrics) {
      this.recordChannelMetricsHistory(
        match.listing.id,
        snapshot.platform,
        updated.metrics,
        snapshot.source ?? updated.metrics.metricsSource,
        snapshot.capturedAt ?? updated.metrics.capturedAt
      );
    }

    return {
      listing: this.getListing(match.listing.id),
      channel: updated
    };
  }

  getLiveView(listingId) {
    const listing = this.getListing(listingId);
    if (!listing) return null;

    const channels = dedupeChannels(listing.channels);
    const freshnessByPlatform = channels.map((channel) => ({
      platform: channel.platform,
      liveFreshness: channelFreshness(channel),
      metricsFreshness: channel.metrics?.metricsFreshness ?? "unknown",
      lastSeenAt: channel.lastSeenAt,
      capturedAt: channel.metrics?.capturedAt ?? null
    }));
    const stalePlatforms = freshnessByPlatform
      .filter((item) => item.liveFreshness !== "fresh" || item.metricsFreshness === "stale")
      .map((item) => item.platform);
    const bestCurrentLivePrice = channels
      .map((channel) => channel.livePrice)
      .filter((price) => price != null)
      .sort((a, b) => b - a)[0] ?? null;

    return {
      listing,
      channels,
      divergences: buildDivergences(listing, channels),
      freshness: {
        overall: stalePlatforms.length ? "stale" : channels.length ? "fresh" : "unknown",
        stalePlatforms,
        byPlatform: freshnessByPlatform
      },
      engagementSummary: summarizeEngagement(channels),
      bestCurrentLivePrice
    };
  }

  getEngagementHistory(listingId, days = 30) {
    const numericDays = Math.max(1, Number(days) || 30);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (numericDays - 1));

    const history = this.read().channelMetricHistory
      .filter((entry) => entry.listingId === Number(listingId))
      .filter((entry) => new Date(entry.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      listingId: Number(listingId),
      days: numericDays,
      history,
      summary: {
        last7Days: trendSummary(history, Math.min(7, numericDays)),
        last30Days: trendSummary(history, Math.min(30, numericDays))
      }
    };
  }

  addScanHistory(query, analysis) {
    let created;
    this.update((data) => {
      created = {
        id: data.meta.nextScanId++,
        query,
        analysis: JSON.stringify(analysis),
        createdAt: new Date().toISOString()
      };
      data.scanHistory.unshift(created);
      data.scanHistory = data.scanHistory.slice(0, 30);
      return data;
    });
    return created;
  }

  getScanHistory() {
    return this.read().scanHistory.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getBags() {
    const data = this.read();
    const bags = [];
    for (let bagNumber = 1; bagNumber < data.meta.nextBagNumber; bagNumber += 1) {
      const item = data.listings.find((listing) => listing.bagNumber === bagNumber) ?? null;
      bags.push({ bagNumber, item });
    }
    return bags.sort((a, b) => b.bagNumber - a.bagNumber);
  }

  getBag(bagNumber) {
    return this.getBags().find((bag) => bag.bagNumber === bagNumber) ?? null;
  }

  getDashboardStats() {
    const listings = this.read().listings;
    const sold = listings.filter((item) => item.status === "sold" && item.soldPrice != null);
    const active = listings.filter((item) => item.status === "active");
    const totalRevenue = sold.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0);
    const totalProfit = sold.reduce((sum, item) => sum + Number(item.soldPrice || 0) - Number(item.costPrice || 0), 0);
    const avgProfit = sold.length ? totalProfit / sold.length : 0;

    const monthlySales = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      monthStart.setMonth(monthStart.getMonth() - offset);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const monthSold = sold.filter((item) => {
        const soldAt = item.soldAt ? new Date(item.soldAt) : null;
        return soldAt && soldAt >= monthStart && soldAt < monthEnd;
      });

      const revenue = monthSold.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0);
      const profit = monthSold.reduce((sum, item) => sum + Number(item.soldPrice || 0) - Number(item.costPrice || 0), 0);

      monthlySales.push({
        label: monthLabel(monthStart),
        revenue: Math.round(revenue),
        profit: Math.round(profit),
        sales: monthSold.length
      });
    }

    const platformBreakdown = DEFAULT_PLATFORMS.map((platform) => {
      const platformSold = sold.filter((item) => item.platform === platform);
      return {
        platform,
        sales: platformSold.length,
        revenue: platformSold.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0)
      };
    });

    return {
      totalRevenue,
      totalProfit,
      avgProfit,
      activeListings: active.length,
      totalItems: listings.length,
      soldItems: sold.length,
      monthlySales,
      platformBreakdown
    };
  }

  getPlatformStats() {
    const listings = this.read().listings;
    const liveChannels = listings.flatMap((listing) =>
      (listing.channels ?? []).map((channel) => ({
        listingId: listing.id,
        listingStatus: listing.status,
        category: listing.category,
        ...channel
      }))
    );
    const platforms = new Set(DEFAULT_PLATFORMS);

    for (const listing of listings) {
      if (listing.platform) platforms.add(listing.platform);
    }
    for (const channel of liveChannels) {
      if (channel.platform) platforms.add(channel.platform);
    }

    return [...platforms].map((platform) => {
      const items = listings.filter((item) => item.platform === platform);
      const sold = items.filter((item) => item.status === "sold" && item.soldPrice != null);
      const active = items.filter((item) => item.status === "active");
      const revenue = sold.reduce((sum, item) => sum + Number(item.soldPrice || 0), 0);
      const profit = sold.reduce((sum, item) => sum + Number(item.soldPrice || 0) - Number(item.costPrice || 0), 0);
      const avgMargin = sold.length
        ? Math.round(
            sold.reduce((sum, item) => {
              const soldPrice = Number(item.soldPrice || 0);
              const profitValue = soldPrice - Number(item.costPrice || 0);
              return sum + (soldPrice > 0 ? (profitValue / soldPrice) * 100 : 0);
            }, 0) / sold.length
          )
        : 0;

      const counts = new Map();
      for (const item of items) {
        const key = item.category || "Uncategorized";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const topCategories = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count }));

      const platformChannels = liveChannels.filter((channel) => channel.platform === platform);
      const activeLiveChannels = platformChannels.filter((channel) => channel.liveStatus === "active");
      const staleChannelCount = platformChannels.filter((channel) => {
        const liveFreshness = channelFreshness(channel);
        const metricsFreshness = channel.metrics?.metricsFreshness ?? "unknown";
        return liveFreshness !== "fresh" || metricsFreshness === "stale";
      }).length;
      const totalViews = platformChannels.reduce((sum, channel) => sum + (channel.metrics?.views ?? 0), 0);
      const totalInterest = platformChannels.reduce((sum, channel) => sum + (channel.metrics?.interestCount ?? 0), 0);

      return {
        platform,
        totalItems: items.length,
        soldItems: sold.length,
        activeItems: active.length,
        revenue,
        profit,
        avgMargin,
        topCategories,
        linkedChannels: platformChannels.length,
        activeLiveChannels: activeLiveChannels.length,
        totalViews,
        totalInterest,
        avgInterestPerActiveListing: activeLiveChannels.length
          ? Number((totalInterest / activeLiveChannels.length).toFixed(2))
          : 0,
        staleChannelCount
      };
    });
  }
}
