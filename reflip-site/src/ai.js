const BRAND_RULES = [
  { match: /zara/i, brand: "Zara", category: "Jacket", basePrice: 34, era: "Modern" },
  { match: /patagonia/i, brand: "Patagonia", category: "Outerwear", basePrice: 48, era: "2010s" },
  { match: /levi|levis/i, brand: "Levi's", category: "Denim", basePrice: 52, era: "Vintage" },
  { match: /coach/i, brand: "Coach", category: "Bag", basePrice: 70, era: "2000s" },
  { match: /nike/i, brand: "Nike", category: "Streetwear", basePrice: 38, era: "Modern" },
  { match: /lululemon/i, brand: "Lululemon", category: "Activewear", basePrice: 45, era: "Modern" },
  { match: /carhartt/i, brand: "Carhartt", category: "Workwear", basePrice: 58, era: "Modern" },
  { match: /bag|purse|tote/i, brand: "Unknown", category: "Bag", basePrice: 42, era: "Contemporary" },
  { match: /jacket|coat|utility jacket|shirt jacket/i, brand: "Unknown", category: "Jacket", basePrice: 44, era: "Contemporary" },
  { match: /jeans|denim/i, brand: "Unknown", category: "Denim", basePrice: 34, era: "Contemporary" },
  { match: /dress/i, brand: "Unknown", category: "Dress", basePrice: 36, era: "Contemporary" },
  { match: /sneaker|shoe|boot/i, brand: "Unknown", category: "Shoes", basePrice: 40, era: "Contemporary" }
];

const PLATFORM_MODIFIERS = {
  depop: 1.08,
  vinted: 0.9,
  poshmark: 1.02,
  ebay: 0.97
};

const PLATFORM_FEES = {
  depop: { rate: 0.1, extra: 1.5, note: "Approx. 10% + processing" },
  vinted: { rate: 0.03, extra: 0.7, note: "Low seller fee estimate" },
  poshmark: { rate: 0.2, extra: 0, note: "Approx. 20% seller fee" },
  ebay: { rate: 0.13, extra: 0.3, note: "Approx. 13% + processing" }
};

function slugScore(text) {
  return [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function titleCase(text) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function detectAttributes(input) {
  const fallback = {
    brand: "Unknown",
    category: "Fashion",
    basePrice: 32,
    era: "Contemporary"
  };

  const found = BRAND_RULES.find((rule) => rule.match.test(input)) ?? fallback;
  const normalized = input.trim().replace(/\s+/g, " ");
  const title = normalized ? titleCase(normalized) : `${found.brand} ${found.category}`;

  return {
    ...found,
    title
  };
}

function extractSize(text) {
  const match = text.match(/\b(XXS|XS|S|M|L|XL|XXL|2XL|3XL|0|2|4|6|8|10|12|14|16|18|20|22|24|26|28|30|32|34)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractColors(text) {
  const knownColors = [
    "tan",
    "cream",
    "beige",
    "black",
    "white",
    "brown",
    "navy",
    "blue",
    "green",
    "olive",
    "pink",
    "red",
    "grey",
    "gray"
  ];
  const found = knownColors.filter((color) => new RegExp(`\\b${color}\\b`, "i").test(text));
  if (found.length === 0) return "neutral";
  return found.map((color) => color.charAt(0).toUpperCase() + color.slice(1)).join(" and ");
}

function extractCondition(text) {
  if (/new with tags|nwt/i.test(text)) return "new with tags";
  if (/like new/i.test(text)) return "very good, like new";
  if (/excellent/i.test(text)) return "excellent pre-owned condition";
  if (/good/i.test(text)) return "good pre-owned condition";
  return "very good, no major flaws";
}

function makeHashtags(text, brand, category) {
  const base = [
    brand && brand !== "Unknown" ? `#${brand.replace(/[^a-z0-9]/gi, "").toLowerCase()}` : null,
    category ? `#${category.replace(/[^a-z0-9]/gi, "").toLowerCase()}` : null,
    /neutral|tan|beige|cream/i.test(text) ? "#neutralstyle" : "#resellerfind",
    /minimal|capsule|clean girl|old money|pinterest/i.test(text) ? "#capsulewardrobe" : "#thriftflip",
    /jacket/i.test(text) ? "#layeringpiece" : "#secondhandstyle"
  ].filter(Boolean);

  return [...new Set(base)].slice(0, 8);
}

function buildPlatformPrices(basePrice, seed) {
  return Object.entries(PLATFORM_MODIFIERS).reduce((acc, [platform, modifier], index) => {
    const center = Math.round(basePrice * modifier + (seed % (6 + index)) - 2);
    const minPrice = Math.max(8, center - 8 - index);
    const maxPrice = center + 10 + index * 2;
    acc[platform] = {
      minPrice,
      maxPrice,
      score: clamp(5 + ((seed + index * 3) % 5), 5, 9),
      reason:
        platform === "depop"
          ? "Great for trend-led buyers and styled photos."
          : platform === "vinted"
            ? "Moves quickly with slightly sharper pricing."
            : platform === "poshmark"
              ? "Good bundle potential and healthy margins."
              : "Reliable reach with steady sold comps."
    };
    return acc;
  }, {});
}

function buildMarketData(platforms) {
  return Object.entries(platforms).map(([platform, price], index) => ({
    platform,
    count: 8 + index * 3,
    avgPrice: Math.round((price.minPrice + price.maxPrice) / 2),
    minPrice: price.minPrice,
    maxPrice: price.maxPrice,
    isSoldData: index % 2 === 0
  }));
}

async function callOpenAIJson({ system, user, schemaName, schema }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  if (!json.output_text) {
    throw new Error("OpenAI API returned an empty response.");
  }

  return JSON.parse(json.output_text);
}

function templateListingText({ title, brand, category, colors, size, condition, styleNotes, hashtags }) {
  const leadBrand = brand && brand !== "Unknown" ? brand.toUpperCase() : title.toUpperCase();
  const capsuleLine = /neutral|tan|beige|cream/i.test(colors)
    ? "Super versatile neutral piece — capsule wardrobe essential ✨"
    : "Easy styling piece with strong resale appeal ✨";
  const styleLine = styleNotes || "Effortless minimal, Pinterest-friendly styling.";
  return `${leadBrand} ${colors.toLowerCase()} ${category.toLowerCase()} 🤍
${brand !== "Unknown" ? `Brand-forward find with clean resale appeal.\n` : ""}Ready to wear and easy to style.

${capsuleLine}
${styleLine}

Size: ${size || "see measurements"} — relaxed fit
Condition: ${condition}

Trending NOW: clean layering, neutral styling, easy everyday outfits

Perfect for spring layering, fall outfits, over basics or dresses
Pairs with jeans, trousers, skirts, cargo pants

Open to offers 📩

${hashtags.join(" ")}`;
}

function buildPlatformDescriptions(base, title, size, priceMap) {
  return Object.keys(PLATFORM_FEES).reduce((acc, platform) => {
    const fee = PLATFORM_FEES[platform];
    const listPrice = priceMap[platform];
    const netAfterFees = Math.max(0, Math.round(listPrice - listPrice * fee.rate - fee.extra));
    acc[platform] = {
      title:
        platform === "ebay"
          ? `${title}${size ? ` Size ${size}` : ""}`
          : title,
      description:
        platform === "ebay"
          ? `${base}\n\nFast shipping. Measurements available on request.`
          : platform === "poshmark"
            ? `${base}\n\nBundle-friendly and open to reasonable offers.`
            : base,
      listPrice,
      netAfterFees,
      feeNote: fee.note
    };
    return acc;
  }, {});
}

function fallbackQuickListing({ description = "", imageCount = 0, filenames = [] }) {
  const descriptor = [description, ...filenames].filter(Boolean).join(" ").trim() || "mystery thrift find";
  const attrs = detectAttributes(descriptor);
  const size = extractSize(descriptor);
  const colors = extractColors(descriptor);
  const condition = extractCondition(descriptor);
  const hashtags = makeHashtags(descriptor, attrs.brand, attrs.category);
  const seed = slugScore(`${descriptor}|${imageCount}`);
  const priceBand = buildPlatformPrices(attrs.basePrice, seed);
  const listPriceMap = Object.fromEntries(
    Object.entries(priceBand).map(([platform, stats]) => [platform, Math.round((stats.minPrice + stats.maxPrice) / 2)])
  );
  const styleNotes = /old money|clean girl|capsule|minimal/i.test(descriptor)
    ? "Effortless minimal, clean girl, old money aesthetic"
    : "Easy to style, photo-friendly piece with current resale appeal";
  const title = `${attrs.brand !== "Unknown" ? `${attrs.brand} ` : ""}${colors} ${attrs.category}`.trim();
  const baseDescription = templateListingText({
    title,
    brand: attrs.brand,
    category: attrs.category,
    colors,
    size,
    condition,
    styleNotes,
    hashtags
  });

  return {
    title,
    itemName: title,
    description: baseDescription,
    brand: attrs.brand,
    category: attrs.category,
    size,
    condition,
    era: attrs.era,
    profitabilityRating: Math.max(...Object.values(listPriceMap)) >= 45 ? "high" : "medium",
    tips: imageCount
      ? "Use one clean front photo, one label shot, one measurements shot, and one flaws shot."
      : "Add material, measurements, and one styling keyword to improve conversion.",
    hashtags,
    platforms: buildPlatformDescriptions(baseDescription, title, size, listPriceMap)
  };
}

async function openAIQuickListing({ description = "", imageCount = 0, filenames = [] }) {
  const descriptor = [description, ...filenames].filter(Boolean).join(" ").trim() || "mystery thrift find";
  const attrs = detectAttributes(descriptor);
  const seed = slugScore(`${descriptor}|${imageCount}|openai`);
  const priceBand = buildPlatformPrices(attrs.basePrice, seed);
  const basePrices = Object.fromEntries(
    Object.entries(priceBand).map(([platform, stats]) => [platform, Math.round((stats.minPrice + stats.maxPrice) / 2)])
  );

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      brand: { type: "string" },
      category: { type: "string" },
      size: { type: "string" },
      condition: { type: "string" },
      era: { type: "string" },
      profitabilityRating: { type: "string", enum: ["high", "medium", "low"] },
      tips: { type: "string" },
      hashtags: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 10
      },
      platforms: {
        type: "object",
        additionalProperties: false,
        properties: {
          depop: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "description"]
          },
          vinted: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "description"]
          },
          poshmark: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "description"]
          },
          ebay: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              description: { type: "string" }
            },
            required: ["title", "description"]
          }
        },
        required: ["depop", "vinted", "poshmark", "ebay"]
      }
    },
    required: ["title", "brand", "category", "size", "condition", "era", "profitabilityRating", "tips", "hashtags", "platforms"]
  };

  const system = `You create resale marketplace listings for a solo online reseller.
Return JSON only.
Write texts in the same style as this example: "ZARA beige utility jacket / shirt jacket 🤍 ... Open to offers 📩 ... hashtags".
Keep descriptions natural, persuasive, and ready to copy-paste.
Do not claim live market data.
Platform titles should be optimized for each marketplace but still concise.`;

  const user = `Item notes:
${descriptor}

Detected defaults:
- brand: ${attrs.brand}
- category: ${attrs.category}
- era: ${attrs.era}
- suggested list prices: ${JSON.stringify(basePrices)}
- image count: ${imageCount}

Please create:
1. one main title
2. hashtags
3. platform-specific title + description for depop, vinted, poshmark, ebay
4. keep tone close to the Zara example the user gave
5. descriptions should be practical for reselling, with spacing and emoji when it fits`;

  const parsed = await callOpenAIJson({
    system,
    user,
    schemaName: "listing_pack",
    schema
  });

  return {
    title: parsed.title,
    itemName: parsed.title,
    description: parsed.platforms.depop.description,
    brand: parsed.brand || attrs.brand,
    category: parsed.category || attrs.category,
    size: parsed.size || extractSize(descriptor),
    condition: parsed.condition || extractCondition(descriptor),
    era: parsed.era || attrs.era,
    profitabilityRating: parsed.profitabilityRating || "medium",
    tips: parsed.tips,
    hashtags: parsed.hashtags,
    platforms: Object.fromEntries(
      Object.entries(parsed.platforms).map(([platform, content]) => {
        const fee = PLATFORM_FEES[platform];
        const listPrice = basePrices[platform];
        const netAfterFees = Math.max(0, Math.round(listPrice - listPrice * fee.rate - fee.extra));
        return [
          platform,
          {
            title: content.title,
            description: content.description,
            listPrice,
            netAfterFees,
            feeNote: fee.note
          }
        ];
      })
    )
  };
}

export async function generateQuickListing(input) {
  try {
    const openaiResult = await openAIQuickListing(input);
    if (openaiResult) {
      return openaiResult;
    }
  } catch (error) {
    console.warn("Falling back to local quick listing generator:", error.message);
  }

  return fallbackQuickListing(input);
}

export function generateScanAnalysis({ query, size = "", source = "text" }) {
  const seed = slugScore(`${query}|${size}|${source}`);
  const attrs = detectAttributes(query);
  const platforms = buildPlatformPrices(attrs.basePrice, seed);
  const bestPlatform = Object.entries(platforms).sort((a, b) => b[1].maxPrice - a[1].maxPrice)[0];
  const estimatedLow = Math.max(8, Math.round(bestPlatform[1].maxPrice * 0.45));
  const estimatedHigh = Math.max(estimatedLow + 6, Math.round(bestPlatform[1].maxPrice * 0.7));
  const sellScore = clamp(Math.round(bestPlatform[1].score + (seed % 3)), 4, 9);
  const trendScore = clamp(5 + (seed % 5), 5, 9);
  const profitabilityRating = estimatedHigh >= 30 ? "high" : estimatedHigh >= 18 ? "medium" : "low";

  return {
    itemName: attrs.title,
    title: attrs.title,
    brand: attrs.brand,
    category: attrs.category,
    era: attrs.era,
    size: size || null,
    condition: "Good",
    sellScore,
    trendScore,
    profitabilityRating,
    recommendation: `Worth considering if it's clean. ${bestPlatform[0]} looks strongest, and the projected resale spread leaves room for profit after fees.`,
    estimatedProfit: {
      low: estimatedLow,
      high: estimatedHigh
    },
    buyAt: {
      ideal: Math.max(6, Math.round(estimatedLow * 0.35)),
      max: Math.max(10, Math.round(estimatedLow * 0.6))
    },
    platforms,
    rawMarketData: buildMarketData(platforms),
    sellingPoints: [
      `Strong buyer demand for ${attrs.category.toLowerCase()} pieces.`,
      "Easy item to crosslist across multiple platforms.",
      "Clear resale positioning with room for margin."
    ],
    checkFor: [
      "Major stains or odor",
      "Missing hardware, zippers, or buttons",
      "Excessive wear on cuffs, handles, or hems"
    ],
    hashtags: makeHashtags(query, attrs.brand, attrs.category)
  };
}

function windowTotals(history = [], fromDaysAgo, toDaysAgo = 0) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  start.setDate(start.getDate() - fromDaysAgo);
  end.setDate(end.getDate() - toDaysAgo);

  return history.reduce(
    (acc, entry) => {
      const entryDate = new Date(entry.date);
      if (entryDate < start || entryDate > end) return acc;
      acc.views += entry.metrics?.views ?? 0;
      acc.interest += entry.metrics?.interestCount ?? 0;
      return acc;
    },
    { views: 0, interest: 0 }
  );
}

function pushSuggestion(list, suggestion) {
  if (!list.some((item) => item.type === suggestion.type && item.issue === suggestion.issue)) {
    list.push(suggestion);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function suggestListingImprovements(listing, liveView = null, engagementHistory = null) {
  const suggestions = [];
  if (!listing.title || listing.title.length < 18) {
    pushSuggestion(suggestions, {
      type: "title",
      issue: "Title is short and may miss buyer keywords.",
      fix: "Add brand, item type, color, and standout detail."
    });
  }
  if (!listing.description || listing.description.length < 80) {
    pushSuggestion(suggestions, {
      type: "description",
      issue: "Description feels thin for resale shoppers.",
      fix: "Mention condition, measurements, flaws, and shipping speed."
    });
  }
  if (!listing.listedPrice) {
    pushSuggestion(suggestions, {
      type: "pricing",
      issue: "No clear listing price is set.",
      fix: "Start near the upper middle of the suggested market range, then send offers."
    });
  }

  const channels = liveView?.channels ?? [];
  const freshChannels = channels.filter((channel) => channel.metrics?.metricsFreshness === "fresh" || channel.lastSeenAt);
  const bestSignal = [...freshChannels].sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))[0];
  const stalePlatforms = liveView?.freshness?.stalePlatforms ?? [];

  if (stalePlatforms.length) {
    pushSuggestion(suggestions, {
      type: "sync",
      issue: `Live sync is stale on ${stalePlatforms.join(", ")}.`,
      fix: "Refresh those channels before making pricing decisions so ReFlip uses current marketplace data."
    });
  }

  if (bestSignal) {
    const views = bestSignal.metrics?.views ?? null;
    const interest = bestSignal.metrics?.interestCount ?? null;
    const platformLabel = bestSignal.platform.charAt(0).toUpperCase() + bestSignal.platform.slice(1);
    const interestRate = views && interest != null ? interest / Math.max(views, 1) : null;

    if (views != null && views <= 20 && (interest ?? 0) <= 2) {
      pushSuggestion(suggestions, {
        type: "visibility",
        issue: `${platformLabel} is getting low visibility so the listing is not reaching enough buyers yet.`,
        fix: "Tighten the first 5 words of the title, improve the cover photo, and check category + keywords before discounting."
      });
    }

    if (views != null && views >= 50 && (interest ?? 0) <= 2) {
      pushSuggestion(suggestions, {
        type: "pricing",
        issue: `${platformLabel} has views but weak saves/likes, which usually points to price or copy friction.`,
        fix: "Test a smaller price drop, add measurements/materials, and make the first photo more direct about fit and condition."
      });
    }

    if (views != null && views >= 60 && (interest ?? 0) >= 5 && listing.status !== "sold") {
      pushSuggestion(suggestions, {
        type: "conversion",
        issue: `${platformLabel} is attracting attention, but the item still has not converted.`,
        fix: "Hold visibility steady and focus on conversion: answer likely objections in the description and test offers before a full relist."
      });
    }

    if (interestRate != null && interestRate >= 0.15) {
      pushSuggestion(suggestions, {
        type: "timing",
        issue: `${platformLabel} interest is healthy relative to views.`,
        fix: "Avoid an aggressive markdown yet. Let the listing breathe a bit longer or send targeted offers first."
      });
    }
  }

  const history = engagementHistory?.history ?? [];
  if (history.length) {
    const last7 = windowTotals(history, 6, 0);
    const previous7 = windowTotals(history, 13, 7);

    if (last7.views > previous7.views || last7.interest > previous7.interest) {
      pushSuggestion(suggestions, {
        type: "trend",
        issue: "Engagement is moving up over the last 7 days.",
        fix: "Keep the listing live, avoid a hard reset, and try a smaller offer test before relisting."
      });
    } else if (last7.views <= previous7.views && last7.interest <= previous7.interest && last7.views > 0) {
      pushSuggestion(suggestions, {
        type: "refresh",
        issue: "Engagement has flattened compared with the previous week.",
        fix: "Refresh photos, reorder the cover image, and tighten the first sentence so the listing can regain momentum."
      });
    }
  }

  return {
    suggestions,
    newTitle:
      listing.brand && listing.title && !new RegExp(`^${escapeRegExp(listing.brand)}\\b`, "i").test(listing.title)
        ? `${listing.brand} ${listing.title}`.trim()
        : listing.title,
    liveContext: {
      channelCount: channels.length,
      stalePlatforms,
      engagementSummary: liveView?.engagementSummary ?? null
    }
  };
}

export function generateDashboardRecommendations(stats, platformStats) {
  const bestPlatform = [...platformStats].sort((a, b) => b.profit - a.profit)[0];
  const slowPlatform = [...platformStats].sort((a, b) => a.soldItems - b.soldItems)[0];
  const recommendations = [
    {
      type: "pricing",
      title: "Refresh older active listings",
      detail: "Send offers or relist stale inventory to keep engagement moving.",
      priority: "medium"
    },
    {
      type: "platform",
      title: `Lean into ${bestPlatform?.platform ?? "your best platform"}`,
      detail: bestPlatform
        ? `${bestPlatform.platform} is currently your best profit channel. Add your next strong item there first.`
        : "Once items sell, the app will highlight your strongest platform automatically.",
      priority: "high"
    },
    {
      type: "inventory",
      title: "Source around your proven winners",
      detail: stats.soldItems > 0
        ? "Look for more of the categories that already sold with healthy margins."
        : "Use the scanner before buying so you build a profitable first batch.",
      priority: "medium"
    },
    {
      type: "channel",
      title: `Test a relist on ${slowPlatform?.platform ?? "another channel"}`,
      detail: slowPlatform
        ? `${slowPlatform.platform} has the least sales so far. Try stronger titles or a lower starting price there.`
        : "Spread your best items across more than one marketplace to learn what moves fastest.",
      priority: "low"
    }
  ];

  return {
    topInsight: bestPlatform?.platform
      ? `${bestPlatform.platform} is leading your profits right now`
      : "No sales yet, but your workflow is ready",
    recommendations
  };
}
