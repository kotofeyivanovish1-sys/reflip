import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertListingSchema } from "../shared/schema";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import fs from "fs";
import path from "path";
import { searchAllPlatforms } from "./marketSearch";

const upload = multer({ dest: "/tmp/reflip-uploads/" });

function getAI() {
  return new Anthropic();
}

/** Extract userId from Bearer token. Returns null if invalid. */
function getAuthUserId(req: Request): number | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    const decoded = Buffer.from(auth.replace("Bearer ", ""), "base64").toString();
    const [id, email] = decoded.split(":");
    if (!id || !email) return null;
    const uid = Number(id);
    if (!uid || isNaN(uid)) return null;
    return uid;
  } catch { return null; }
}

/** Respond 401 and return null if not authenticated. Use like: const uid = requireAuth(req, res); if (!uid) return; */
function requireAuth(req: Request, res: Response): number | null {
  const uid = getAuthUserId(req);
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return uid;
}

/** Robustly parse JSON from AI responses */
function safeParseJSON(text: string): any | null {
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw = match[0];

  try { return JSON.parse(raw); } catch {}

  try {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) { result += ch; escaped = false; continue; }
      if (ch === '\\') { result += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; result += ch; continue; }
      if (inString) {
        if (ch === '\n') { result += '\\n'; continue; }
        if (ch === '\r') { continue; }
        if (ch === '\t') { result += '\\t'; continue; }
      }
      result += ch;
    }
    return JSON.parse(result);
  } catch {}

  return null;
}

export function registerRoutes(httpServer: Server, app: Express) {
  // === HEALTHCHECK (public — used by Railway) ===
  app.get("/api/health", (_, res) => res.json({ ok: true }));

  // === AUTH ===
  app.post("/api/auth/register", async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return void res.status(400).json({ error: "Email and password required" });
    if (password.length < 6) return void res.status(400).json({ error: "Password must be at least 6 characters" });
    try {
      const user = await storage.createUser(email.toLowerCase().trim(), password, name);
      res.json({ user, token: Buffer.from(`${user.id}:${email}`).toString("base64") });
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) return void res.status(409).json({ error: "Email already registered" });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return void res.status(400).json({ error: "Email and password required" });
    const user = await storage.verifyUser(email.toLowerCase().trim(), password);
    if (!user) return void res.status(401).json({ error: "Invalid email or password" });
    res.json({ user, token: Buffer.from(`${user.id}:${email}`).toString("base64") });
  });

  app.get("/api/auth/me", (req, res) => {
    const auth = req.headers.authorization;
    if (!auth) return void res.status(401).json({ error: "Not authenticated" });
    try {
      const decoded = Buffer.from(auth.replace("Bearer ", ""), "base64").toString();
      const [id, email] = decoded.split(":");
      const user = storage.getUserByEmail(email);
      if (!user || user.id !== Number(id)) return void res.status(401).json({ error: "Invalid token" });
      const { passwordHash, ...safe } = user;
      res.json({ user: safe });
    } catch { res.status(401).json({ error: "Invalid token" }); }
  });

  // === LISTINGS ===
  app.get("/api/listings", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { status, platform } = req.query as { status?: string; platform?: string };
    const data = storage.getListings(userId, status, platform);
    res.json(data);
  });

  app.get("/api/listings/:id", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const item = storage.getListing(Number(req.params.id), userId);
    if (!item) return void res.status(404).json({ error: "Not found" });
    res.json(item);
  });

  app.post("/api/listings", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const body = {
        ...req.body,
        title: req.body.title || "Untitled item",
        description: req.body.description || req.body.title || "—",
        condition: req.body.condition || "good",
        platform: req.body.platform || "depop",
        costPrice: Number(req.body.costPrice) || 0,
      };
      const data = insertListingSchema.parse(body);
      const result = storage.createListing(data, userId);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/listings/:id", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const result = storage.updateListing(Number(req.params.id), req.body, userId);
    if (!result) return void res.status(404).json({ error: "Not found" });
    res.json(result);
  });

  app.delete("/api/listings/:id", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    storage.deleteListing(Number(req.params.id), userId);
    res.json({ success: true });
  });

  // === DASHBOARD STATS ===
  app.get("/api/stats/dashboard", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    res.json(storage.getDashboardStats(userId));
  });

  // === PLATFORM ANALYTICS ===
  app.get("/api/stats/platforms", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    res.json(storage.getPlatformAnalytics(userId));
  });

  // === AI: QUICK LISTING ===
  app.post("/api/ai/quick-listing", upload.array("images", 8), async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { description } = req.body;
    const files = (req.files as Express.Multer.File[]) || [];
    try {
      const client = getAI();
      const contentParts: any[] = [];

      for (const file of files.slice(0, 4)) {
        try {
          const buf = fs.readFileSync(file.path);
          contentParts.push({
            type: "image",
            source: { type: "base64", media_type: file.mimetype as any, data: buf.toString("base64") }
          });
          fs.unlinkSync(file.path);
        } catch {}
      }

      contentParts.push({
        type: "text",
        text: `You are a pro reseller on Depop/Vinted. Analyze this item and generate listing content for 4 platforms.

Seller notes: "${description || "see images"}"

From images + notes extract: brand, item type, color, material, size, condition, style/era/aesthetic.

PRICING RULES (be realistic, not optimistic):
- Depop: list price, seller nets ~87% after fees
- Vinted: list price = net (0% seller fees)
- Poshmark: seller nets 80% of list price
- eBay: seller nets ~85% after fees

DESCRIPTION STYLE (Depop/Vinted aesthetic — use for ALL platforms):
Write in this exact structure:
1. BRAND + item name + emoji (e.g. "ZARA beige utility jacket 🤍")
2. Material/composition (e.g. "100% cotton, made in Turkey")
3. Style/vibe — 2-3 aesthetic keywords (e.g. "Effortless minimal, clean girl, old money aesthetic ✨")
4. Size + fit (e.g. "Size: XS/S — relaxed fit")
5. Condition (e.g. "Condition: very good, like new, no flaws")
6. Trending NOW line (e.g. "Trending NOW: neutral tones, clean minimal layering, Pinterest aesthetic")
7. Styling tips — what to pair with (e.g. "Pairs with jeans, trousers, skirts, cargo pants")
8. "Open to offers 📩"
9. 5-8 hashtags at the end (#brand #itemtype #color #aesthetic #style)

Use emojis sparingly but effectively: 🤍 ✨ 📩 💕
Tone: brief, trendy, TikTok/Pinterest aesthetic. Write in English.
Use REAL data from the item: actual brand, color, type, size, condition.

IMPORTANT: Respond with ONLY raw JSON, no markdown fences, no extra text.

{
  "title": "Brand Item Color Size",
  "brand": "brand",
  "category": "category",
  "size": "size or null",
  "condition": "good",
  "color": "color",
  "aesthetic": "aesthetic vibe",
  "platforms": {
    "depop":    { "title": "short punchy title", "description": "full Depop/Vinted style description with hashtags", "listPrice": 35, "netAfterFees": 30, "feeNote": "~13% fees", "marketNote": "similar items sell $X-$Y" },
    "vinted":   { "title": "vinted title",       "description": "full Depop/Vinted style description with hashtags", "listPrice": 28, "netAfterFees": 28, "feeNote": "0% seller fees", "marketNote": "vinted range" },
    "poshmark": { "title": "poshmark title",     "description": "full Depop/Vinted style description with hashtags", "listPrice": 40, "netAfterFees": 32, "feeNote": "20% fee", "marketNote": "poshmark range" },
    "ebay":     { "title": "eBay SEO title",     "description": "full Depop/Vinted style description with hashtags", "listPrice": 32, "netAfterFees": 27, "feeNote": "~15% fees", "marketNote": "ebay sold range" }
  },
  "hashtags": ["#brand", "#itemtype", "#color", "#aesthetic", "#style"],
  "profitabilityRating": "high",
  "tips": "one specific selling tip"
}`
      });

      let marketContext = "";
      try {
        const searchQuery = description || "clothing item";
        const marketData = await searchAllPlatforms(searchQuery.slice(0, 50));
        const active = marketData.filter(m => m.avgPrice > 0);
        if (active.length > 0) {
          marketContext = "\n\nREAL LIVE MARKET DATA:\n" + active.map(m =>
            `${m.platform.toUpperCase()}: avg $${m.avgPrice}, range $${m.minPrice}-$${m.maxPrice} (${m.listings.length} listings)`
          ).join("\n");
          contentParts[contentParts.length - 1].text += marketContext + "\n\nUse this real data to set accurate prices.";
        }
      } catch {}

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        messages: [{ role: "user", content: contentParts }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed = safeParseJSON(text);
      if (!parsed) return void res.status(500).json({ error: "AI response parsing failed — please try again." });
      res.json(parsed);
    } catch (e: any) {
      for (const f of (req.files as any[]) || []) try { fs.unlinkSync(f.path); } catch {}
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: GENERATE LISTING TEXT ===
  app.post("/api/ai/generate-listing", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { brand, size, condition, category, description, platforms } = req.body;
    try {
      const client = getAI();
      const prompt = `You are a pro reseller on Depop/Vinted. Generate listing descriptions in this exact style:

1. BRAND + item name + emoji (e.g. "ZARA beige utility jacket 🤍")
2. Material/composition
3. Style/vibe — 2-3 aesthetic keywords (e.g. "Effortless minimal, clean girl, old money aesthetic ✨")
4. Size + fit
5. Condition
6. Trending NOW line
7. Styling tips — what to pair with
8. "Open to offers 📩"
9. 5-8 hashtags (#brand #itemtype #color #aesthetic #style)

Use emojis: 🤍 ✨ 📩 💕. Tone: brief, trendy, TikTok/Pinterest aesthetic. English only.

Item details:
- Brand: ${brand || "Unknown"}
- Category: ${category || "Clothing"}
- Size: ${size || "Unknown"}
- Condition: ${condition}
- Notes: ${description}

Generate for platforms: ${(platforms || ["depop", "vinted"]).join(", ")}.
Also suggest optimal pricing per platform.

Respond in JSON:
{
  "texts": {
    "depop": "title|description",
    "vinted": "title|description"
  },
  "pricing": {
    "depop": 45,
    "vinted": 38
  },
  "hashtags": ["#brand", "#itemtype", "#color", "#aesthetic", "#style"],
  "tips": "brief tip"
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed = safeParseJSON(text);
      if (!parsed) return void res.status(500).json({ error: "AI response parsing failed" });
      res.json(parsed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: GOODWILL SCANNER (text query) ===
  app.post("/api/ai/scan", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { query, size } = req.body;
    try {
      const client = getAI();
      const marketData = await searchAllPlatforms(query, size);
      const activeData = marketData.filter(m => m.avgPrice > 0);
      const marketContext = activeData.length > 0
        ? activeData.map(m => {
            const note = m.platform === "ebay"
              ? `(${m.soldCount} ACTUALLY SOLD items — real final prices)`
              : `(${m.listings.length} active listings — asking prices, final ~20-30% lower)`;
            return `${m.platform.toUpperCase()} ${note}: avg $${m.avgPrice}, range $${m.minPrice}-$${m.maxPrice}, median $${m.medianPrice}.`;
          }).join("\n")
        : "No live market data available — use your knowledge of typical resale prices.";

      const prompt = `You are an expert thrift store reseller with access to REAL current market data.

Item to analyze: ${query}
Size: ${size || "Unknown"}

REAL-TIME MARKET DATA (fetched right now):
${marketContext}

IMPORTANT: eBay data shows ACTUALLY SOLD items (real final prices). Other platforms show active listing prices (asking prices, typically 20-40% higher than final sale). Use this to give the most accurate pricing analysis.

Based on this real data + your expertise, provide:
1. Sell score (1-10): how fast and easy to sell
2. Trend score (1-10): is demand growing?
3. Best platform recommendation
4. Realistic price range for each platform (based on the real data above)
5. Estimated profit (assume $5-15 thrift store cost)
6. Key selling points
7. What to check for (defects, fakes, authenticity)
8. Max you should pay at the thrift store

Respond in JSON:
{
  "itemName": "clean item name",
  "sellScore": 8,
  "trendScore": 7,
  "profitabilityRating": "high",
  "dataSource": "real-time",
  "platforms": {
    "depop": { "minPrice": 35, "maxPrice": 55, "score": 9, "reason": "..." },
    "vinted": { "minPrice": 28, "maxPrice": 40, "score": 7, "reason": "..." },
    "poshmark": { "minPrice": 40, "maxPrice": 60, "score": 8, "reason": "..." },
    "ebay": { "minPrice": 30, "maxPrice": 50, "score": 6, "reason": "based on X sold items" }
  },
  "estimatedProfit": { "low": 20, "high": 45 },
  "sellingPoints": ["point1", "point2", "point3"],
  "checkFor": ["check1", "check2"],
  "recommendation": "Short overall recommendation mentioning the real prices found",
  "buyAt": { "max": 12, "ideal": 8 }
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const result = safeParseJSON(text);
      if (!result) return void res.status(500).json({ error: "AI response parsing failed" });

      result.rawMarketData = marketData.map(m => ({
        platform: m.platform,
        count: m.platform === "ebay" ? m.soldCount : m.listings.length,
        avgPrice: m.avgPrice,
        minPrice: m.minPrice,
        maxPrice: m.maxPrice,
        medianPrice: m.medianPrice,
        isSoldData: m.platform === "ebay",
      }));

      storage.createScanResult({ query, imageUrl: null, analysis: JSON.stringify(result) }, userId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: GOODWILL SCANNER (image upload) ===
  app.post("/api/ai/scan-image", upload.single("image"), async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    if (!req.file) return void res.status(400).json({ error: "No image uploaded" });
    const size = req.body?.size || "Unknown";
    try {
      const client = getAI();
      const imageBuffer = fs.readFileSync(req.file.path);
      const base64Image = imageBuffer.toString("base64");
      const mediaType = (req.file.mimetype || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            {
              type: "text",
              text: `You are an expert thrift store reseller. Look at this clothing item image and analyze its resale potential.

Size: ${size}

Based on what you see (brand, style, condition, era, fabric) and your knowledge of the resale market (Depop, Vinted, Poshmark, eBay), provide a detailed analysis.

Respond in JSON:
{
  "itemName": "identified item name with brand if visible",
  "brand": "brand name or Unknown",
  "category": "clothing category",
  "era": "estimated decade/era",
  "sellScore": 8,
  "trendScore": 7,
  "profitabilityRating": "high",
  "platforms": {
    "depop": { "minPrice": 35, "maxPrice": 55, "score": 9, "reason": "..." },
    "vinted": { "minPrice": 28, "maxPrice": 40, "score": 7, "reason": "..." },
    "poshmark": { "minPrice": 40, "maxPrice": 60, "score": 8, "reason": "..." },
    "ebay": { "minPrice": 30, "maxPrice": 50, "score": 6, "reason": "..." }
  },
  "estimatedProfit": { "low": 20, "high": 45 },
  "sellingPoints": ["point1", "point2", "point3"],
  "checkFor": ["check1", "check2"],
  "recommendation": "Short overall recommendation",
  "buyAt": { "max": 12, "ideal": 8 }
}`
            }
          ]
        }],
      });

      fs.unlinkSync(req.file.path);
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const result = safeParseJSON(text);
      if (!result) return void res.status(500).json({ error: "AI response parsing failed" });

      storage.createScanResult({ query: result.itemName || "Image scan", imageUrl: null, analysis: JSON.stringify(result) }, userId);
      res.json(result);
    } catch (e: any) {
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: IMPROVE DESCRIPTION ===
  app.post("/api/listings/:id/improve-description", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const listing = storage.getListing(Number(req.params.id), userId);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });
    try {
      const client = getAI();
      const prompt = `You are a pro reseller on Depop/Vinted. Improve and expand this existing description into the Depop/Vinted listing style.

Existing description to improve:
"${listing.description}"

Item details:
- Title: ${listing.title}
- Brand: ${listing.brand || "Unknown"}
- Category: ${listing.category || "Clothing"}
- Size: ${listing.size || "Unknown"}
- Condition: ${listing.condition}
- Platform: ${listing.platform}

Rewrite using this exact structure:
1. BRAND + item name + emoji (e.g. "ZARA beige utility jacket 🤍")
2. Material/composition (if known or infer from context)
3. Style/vibe — 2-3 aesthetic keywords (e.g. "Effortless minimal, clean girl, old money aesthetic ✨")
4. Size + fit
5. Condition
6. Trending NOW line
7. Styling tips — what to pair with
8. "Open to offers 📩"
9. 5-8 hashtags (#brand #itemtype #color #aesthetic #style)

Use emojis sparingly: 🤍 ✨ 📩 💕
Tone: brief, trendy, TikTok/Pinterest aesthetic. English only.
Keep the real details from the original description. Make it better, not different.

Respond with ONLY the improved description text, no JSON, no markdown fences.`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      if (!text.trim()) return void res.status(500).json({ error: "AI returned empty response" });
      res.json({ description: text.trim() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: LISTING IMPROVEMENT SUGGESTIONS ===
  app.post("/api/ai/suggest", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { listingId } = req.body;
    const listing = storage.getListing(listingId, userId);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });
    try {
      const client = getAI();
      const prompt = `You are a reselling expert. Review this listing and give specific improvement suggestions.

Listing: ${listing.title}
Platform: ${listing.platform}
Price: $${listing.listedPrice}
Condition: ${listing.condition}
Description: ${listing.description}
Days listed: ${listing.createdAt ? Math.floor((Date.now() - new Date(listing.createdAt).getTime()) / 86400000) : "unknown"}

Give 3-5 specific, actionable improvements. Be direct and specific.

Respond in JSON:
{
  "suggestions": [
    { "type": "title", "issue": "...", "fix": "..." },
    { "type": "price", "issue": "...", "fix": "..." },
    { "type": "description", "issue": "...", "fix": "..." }
  ],
  "newTitle": "improved title suggestion",
  "priceAdjustment": -5,
  "urgency": "high"
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const _parsed = safeParseJSON(text);
      if (!_parsed) return void res.status(500).json({ error: "AI parsing failed" });
      res.json(_parsed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === AI: DASHBOARD RECOMMENDATIONS ===
  app.post("/api/ai/recommendations", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const client = getAI();
      const stats = storage.getDashboardStats(userId);
      const activeListings = storage.getListings(userId, "active");
      const pendingListings = storage.getListings(userId, "pending");

      const listingSummary = activeListings.slice(0, 15).map(l =>
        `- "${l.title}" on ${l.platform}, listed $${l.listedPrice}, cost $${l.costPrice}, created ${l.createdAt}`
      ).join("\n");

      const prompt = `You are a reselling business advisor. Analyze this reseller's data and give 4-6 specific, actionable recommendations.

Business stats:
- Total revenue: $${stats.totalRevenue}
- Total profit: $${stats.totalProfit}
- Active listings: ${stats.activeListings}
- Sold items: ${stats.soldItems}
- Avg profit/item: $${stats.avgProfit?.toFixed(0)}
- Pending items: ${pendingListings.length}

Active listings:
${listingSummary || "no active listings"}

Give specific recommendations like:
- Which listings need price adjustment and why
- Which have been listed too long (if created_at is old)
- Platform suggestions based on item type
- Quick win opportunities
- Sourcing tips based on what's selling

Respond in JSON:
{
  "recommendations": [
    {
      "type": "price|platform|timing|sourcing|action",
      "priority": "high|medium|low",
      "title": "Short recommendation title",
      "detail": "Specific actionable detail",
      "listingId": null
    }
  ],
  "topInsight": "One sentence key insight"
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const _parsed = safeParseJSON(text);
      if (!_parsed) return void res.status(500).json({ error: "AI parsing failed" });
      res.json(_parsed);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === BAGS ===
  app.get("/api/bags", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    res.json(storage.getBags(userId));
  });

  app.get("/api/bags/:number", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const bag = storage.getBag(userId, Number(req.params.number));
    if (!bag) return void res.status(404).json({ error: "Bag not found" });
    res.json(bag);
  });

  // QR code for a bag
  app.get("/api/bags/:number/qr", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const QRCode = await import("qrcode");
      const bagNumber = req.params.number;
      const bag = storage.getBag(userId, Number(bagNumber));
      const label = bag?.item
        ? `BAG #${bagNumber}\n${bag.item.title}\n${bag.item.platform?.toUpperCase() || ""}\n$${bag.item.listedPrice || ""}`
        : `ReFlip BAG #${bagNumber}`;
      const qr = await QRCode.default.toDataURL(label, {
        width: 300, margin: 2,
        color: { dark: "#1a1a2e", light: "#ffffff" },
      });
      res.json({ bagNumber: Number(bagNumber), qrDataUrl: qr, label, item: bag?.item });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === SCAN HISTORY ===
  app.get("/api/scan-history", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    res.json(storage.getScanResults(userId));
  });
}
