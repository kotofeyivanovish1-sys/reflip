import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertListingSchema } from "../shared/schema";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { searchAllPlatforms, fetchDepopListing, fetchVintedListing, fetchEbayListing, searchEbay, searchVinted, searchDepop } from "./marketSearch";
import type { MarketData, MarketListing } from "./marketSearch";
import AdmZip from "adm-zip";

// Resize image to max 1200px and compress as JPEG — keeps Anthropic request under limits
async function prepareImage(filePath: string): Promise<{ data: string; mime: "image/jpeg" }> {
  const buf = await sharp(filePath)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { data: buf.toString("base64"), mime: "image/jpeg" };
}

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

  // === USER SETTINGS ===
  app.post("/api/user/background", upload.single("image"), (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const file = req.file;
      if (!file) return void res.status(400).json({ error: "No image provided" });
      const uploadsDir = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : ".", "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const ext = path.extname(file.originalname) || ".jpg";
      const filename = `bg_${userId}_${Date.now()}${ext}`;
      const targetPath = path.join(uploadsDir, filename);
      fs.copyFileSync(file.path, targetPath);
      fs.unlinkSync(file.path);
      const url = `/uploads/${filename}`;
      storage.updateUserBackground(userId, url);
      res.json({ success: true, customBackground: url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === MANUAL LISTING SYNC TRIGGER ===
  app.post("/api/sync/run", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const { runAutoSync } = await import("./listingSync");
      // Run in background — don't await
      runAutoSync().catch(e => console.error("[sync] Error:", e.message));
      res.json({ message: "Sync started in background" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === LISTINGS ===
  app.get("/api/listings", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { status, platform } = req.query as { status?: string; platform?: string };
    const data = storage.getListings(userId, status, platform);
    res.json(data);
  });

  // Returns all active listings that have at least one platform URL linked
  // Used by the browser extension for background auto-sync
  app.get("/api/listings/linked", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const all = storage.getListings(userId, "active");
    const linked = all.filter((l: any) => l.depopUrl || l.vintedUrl || l.ebayUrl);
    res.json(linked);
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

  // === DOWNLOAD IMAGES ZIP ===
  app.get("/api/listings/:id/download-images", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const item = storage.getListing(Number(req.params.id), userId);
      if (!item || !item.imageUrl) return void res.status(404).json({ error: "No images found for this listing." });
      
      let images: string[];
      try {
        images = JSON.parse(item.imageUrl);
      } catch {
        images = [item.imageUrl];
      }

      const zip = new AdmZip();
      
      const uploadsDir = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : ".", "uploads");
      
      for (let i = 0; i < images.length; i++) {
        let imgPath = images[i];
        if (imgPath.startsWith("/uploads/")) {
          const localPath = path.join(uploadsDir, imgPath.replace("/uploads/", ""));
          if (fs.existsSync(localPath)) {
            zip.addLocalFile(localPath, "", `listing_${item.id}_image_${i + 1}${path.extname(localPath)}`);
          }
        }
      }
      
      const zipBuffer = zip.toBuffer();
      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename=ReFlip_Listing_${item.id}_Images.zip`);
      res.send(zipBuffer);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
      const savedImageUrls: string[] = [];

      // Ensure uploads directory exists
      const uploadsDir = path.resolve(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : ".", "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      for (const file of files.slice(0, 4)) {
        try {
          const { data, mime } = await prepareImage(file.path);
          contentParts.push({
            type: "image",
            source: { type: "base64", media_type: mime, data }
          });

          // Save image to uploads directory
          const filename = `${crypto.randomUUID()}.jpg`;
          fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(data, "base64"));
          savedImageUrls.push(`/api/uploads/${filename}`);
        } catch {}
        try { fs.unlinkSync(file.path); } catch {}
      }

      contentParts.push({
        type: "text",
        text: `You are an experienced reseller who writes listings that sell fast on Depop, Vinted, and eBay. Your descriptions sound like a real person wrote them, never like AI.

Seller notes: "${description || "see images"}"

From images + notes extract: brand, item type, color, material, size, condition, style/era/aesthetic.

PRICING RULES (be realistic, not optimistic):
- Depop: list price, seller nets ~87% after fees
- Vinted: list price = net (0% seller fees)
- eBay: seller nets ~85% after fees

DESCRIPTION STYLE:
Write like a real Depop/Vinted seller. Natural, casual, authentic voice. Each line is a separate thought, no bullet points, no numbered lists.

FOLLOW THIS EXACT STYLE (real example):
"vintage gap denim shirt, heavy 100% cotton made in Hong Kong 💙

the kind of faded wash you can't buy new anymore, naturally worn in over 30 years

90s workwear, vintage americana, unisex street ✨

fits M-L oversized, chest 23in, length 29in, boxy relaxed, great on smaller frames too

light wear consistent with age, small pull at side seam barely visible, no stains or damage

Trending NOW: vintage denim layering, 90s workwear revival, thrift core

Pairs with wide-leg jeans, cargo pants, biker shorts or tied over a white tee

open to offers 💌

#vintagegap #90sdenim #denimshirt #workwearaesthetic #thriftfinds"

CRITICAL RULES:
- NEVER use em-dashes (—), use commas instead
- NEVER use bullet points or numbered lists
- NEVER use formal/corporate language
- Each line = one thought, separated by blank lines
- Lowercase is fine, feels more authentic
- Use emojis sparingly: 💙 ✨ 💌 🤍 (1-3 per description max)
- Include real measurements if visible in photos
- Mention specific details that make the item special (fabric weight, country of origin, era)
- "Trending NOW" line with current aesthetic trends relevant to the item
- Styling suggestions, what to pair it with
- End with "open to offers 💌" or similar
- 5-8 hashtags at the very end, no spaces between # and word, all lowercase
- Sound like a REAL PERSON, not a bot. Think TikTok/Depop seller energy
- Descriptions must be SEO-optimized: include searchable keywords naturally (brand name, item type, color, material, decade, aesthetic names)

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
    "depop":  { "title": "short punchy title", "description": "full natural description following the style above", "listPrice": 35, "netAfterFees": 30, "feeNote": "~13% fees", "marketNote": "similar items sell $X-$Y" },
    "vinted": { "title": "vinted title",       "description": "full natural description following the style above", "listPrice": 28, "netAfterFees": 28, "feeNote": "0% seller fees", "marketNote": "vinted range" },
    "ebay":   { "title": "eBay SEO title with keywords",     "description": "full natural description following the style above", "listPrice": 32, "netAfterFees": 27, "feeNote": "~15% fees", "marketNote": "ebay sold range" }
  },
  "hashtags": ["#brand", "#itemtype", "#color", "#aesthetic", "#style"],
  "profitabilityRating": "high",
  "tips": "one specific selling tip"
}`
      });

      let marketContext = "";
      let rawMarketData: any[] = [];
      try {
        const searchQuery = description || "clothing item";
        console.log(`[market-search] Searching for: "${searchQuery.slice(0, 50)}"`);
        const marketData = await searchAllPlatforms(searchQuery.slice(0, 50));
        rawMarketData = marketData;
        const active = marketData.filter(m => m.avgPrice > 0);

        if (active.length > 0) {
          marketContext = "\n\nREAL LIVE MARKET DATA FROM PLATFORMS:\n" + active.map(m => {
            const isEbay = m.platform === "ebay";
            const priceType = isEbay ? "ACTUAL SOLD PRICES (real completed sales)" : "ACTIVE ASKING PRICES (real sale price is usually 15-25% lower)";
            let line = `${m.platform.toUpperCase()} — ${priceType}:\n`;
            line += `  avg $${m.avgPrice}, median $${m.medianPrice}, range $${m.minPrice}-$${m.maxPrice}`;
            line += isEbay ? ` (${m.soldCount} sold items)` : ` (${m.listings.length} active listings)`;
            if (m.sampleTitles.length > 0) {
              line += `\n  examples: ${m.sampleTitles.slice(0, 3).map(t => `"${t.slice(0, 50)}"`).join(", ")}`;
            }
            return line;
          }).join("\n\n");

          marketContext += `\n\nPRICING INSTRUCTIONS:
- eBay sold prices are the MOST RELIABLE indicator of real market value
- Active listing prices on Depop/Vinted are 15-25% higher than actual sale prices
- Factor in platform fees when setting list price:
  * Depop: ~13% fee, so list higher to net your target
  * Vinted: 0% seller fee, list price = what you get
  * eBay: ~13-15% total fees (listing + payment)
- Price to SELL, not to sit. Better to sell at fair price than list too high
- Set each platform price independently based on that platform's market + fees`;

          contentParts[contentParts.length - 1].text += marketContext;
          console.log(`[market-search] Found data: ${active.map(m => `${m.platform}=$${m.avgPrice}`).join(", ")}`);
        } else {
          console.log("[market-search] No market data returned from any platform");
          contentParts[contentParts.length - 1].text += `\n\nNo live market data available. Use your knowledge of typical resale prices for this type of item. Price realistically based on brand, condition, and current demand. Factor in platform fees:
- Depop: ~13% fee
- Vinted: 0% seller fee
- eBay: ~13-15% fees`;
        }
      } catch (e: any) {
        console.error("[market-search] Error:", e.message);
      }

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: contentParts }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed = safeParseJSON(text);
      if (!parsed) return void res.status(500).json({ error: "AI response parsing failed — please try again." });
      // Attach saved image URLs so frontend can store them with the listing
      if (savedImageUrls.length > 0) parsed._imageUrls = savedImageUrls;
      // Attach raw market data so frontend can display it
      if (rawMarketData.length > 0) {
        parsed._marketData = rawMarketData.filter(m => m.avgPrice > 0).map(m => ({
          platform: m.platform,
          avgPrice: m.avgPrice,
          medianPrice: m.medianPrice,
          minPrice: m.minPrice,
          maxPrice: m.maxPrice,
          count: m.platform === "ebay" ? m.soldCount : m.listings.length,
          type: m.platform === "ebay" ? "sold" : "active",
        }));
      }
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
      const prompt = `You are an experienced reseller. Write listing descriptions that sound like a real person, never like AI.

Item details:
- Brand: ${brand || "Unknown"}
- Category: ${category || "Clothing"}
- Size: ${size || "not specified"}
- Condition: ${condition}
- Notes: ${description}

Generate for platforms: ${(platforms || ["depop", "vinted"]).join(", ")}.
Also suggest optimal pricing per platform.

DESCRIPTION STYLE (follow this real example):
"vintage gap denim shirt, heavy 100% cotton made in Hong Kong 💙

the kind of faded wash you can't buy new anymore, naturally worn in over 30 years

90s workwear, vintage americana, unisex street ✨

fits M-L oversized, chest 23in, length 29in, boxy relaxed

light wear consistent with age, no stains or damage

Trending NOW: vintage denim layering, 90s workwear revival

Pairs with wide-leg jeans, cargo pants or tied over a white tee

open to offers 💌

#vintagegap #90sdenim #denimshirt #workwearaesthetic #thriftfinds"

RULES:
- NEVER use em-dashes (—), use commas instead
- NEVER use bullet points or numbered lists
- Each line = one thought, separated by blank lines
- Lowercase is fine, sounds more authentic
- Emojis: 1-3 max per description (💙 ✨ 💌 🤍)
- Include "Trending NOW" line and styling tips
- End with "open to offers 💌" and 5-8 hashtags
- Sound like a REAL PERSON, not a bot
- SEO: include brand, item type, color, material, aesthetic keywords naturally

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
      const { data: base64Image, mime: mediaType } = await prepareImage(req.file.path);
      try { fs.unlinkSync(req.file.path); } catch {}

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

Based on what you see (brand, style, condition, era, fabric) and your knowledge of the resale market (Depop, Vinted, eBay), provide a detailed analysis.

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
      const prompt = `Rewrite this listing description so it sounds like a real Depop/Vinted seller wrote it. Keep all the real details, just make it sell better.

Existing description:
"${listing.description}"

Item details:
- Title: ${listing.title}
- Brand: ${listing.brand || "Unknown"}
- Category: ${listing.category || "Clothing"}
- Size: ${listing.size || "not specified"}
- Condition: ${listing.condition}
- Platform: ${listing.platform}

FOLLOW THIS STYLE (real example):
"vintage gap denim shirt, heavy 100% cotton made in Hong Kong 💙

the kind of faded wash you can't buy new anymore, naturally worn in over 30 years

90s workwear, vintage americana, unisex street ✨

fits M-L oversized, chest 23in, length 29in, boxy relaxed

light wear consistent with age, no stains or damage

Trending NOW: vintage denim layering, 90s workwear revival

Pairs with wide-leg jeans, cargo pants or tied over a white tee

open to offers 💌

#vintagegap #90sdenim #denimshirt #workwearaesthetic #thriftfinds"

RULES:
- NEVER use em-dashes (—), use commas instead
- NEVER use bullet points or numbered lists
- Each line = one thought, separated by blank lines
- Lowercase feels more authentic, use it
- Emojis: 1-3 max (💙 ✨ 💌 🤍)
- Include "Trending NOW" line and styling tips
- End with "open to offers 💌" and 5-8 hashtags
- Must NOT sound like AI wrote it. No formal language, no corporate tone
- SEO: include searchable keywords naturally (brand, item type, color, material, aesthetic)
- Keep the REAL details from the original. Make it better, not different.

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
Prices: ${[
  (listing as any).depopPrice ? `Depop $${(listing as any).depopPrice}` : null,
  (listing as any).vintedPrice ? `Vinted $${(listing as any).vintedPrice}` : null,
  (listing as any).ebayPrice ? `eBay $${(listing as any).ebayPrice}` : null,
  !(listing as any).depopPrice && !(listing as any).vintedPrice && !(listing as any).ebayPrice && listing.listedPrice ? `Listed $${listing.listedPrice}` : null,
].filter(Boolean).join(", ") || "not set"}
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

  // Fetch photos from external URL and attach to an existing listing
  app.post("/api/listings/:id/fetch-photos", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const listing = storage.getListing(Number(req.params.id), userId);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });
    const { url } = req.body;
    if (!url) return void res.status(400).json({ error: "Listing URL required" });
    try {
      let data;
      const errors: string[] = [];

      if (url.includes("depop.com")) {
        try {
          const d = await fetchDepopListing(url);
          if (d && d.images && d.images.length > 0) data = d;
          else errors.push("Depop: listing found but no images extracted");
        } catch (e: any) { errors.push(`Depop: ${e.message}`); }
      }
      if (!data && !url.includes("depop.com")) {
        errors.push("URL not recognized as Depop");
      }

      if (!data || data.images.length === 0) {
        const detail = errors.length > 0 ? ` (${errors.join("; ")})` : "";
        console.error(`[fetch-photos] Failed for URL: ${url}${detail}`);
        return void res.status(404).json({
          error: `Could not fetch photos. The platform may be blocking requests from the server.${detail}`
        });
      }

      // Store images as JSON array in imageUrl field
      const imageUrl = JSON.stringify(data.images);
      const updated = storage.updateListing(Number(req.params.id), { imageUrl } as any, userId);
      res.json({ images: data.images, listing: updated });
    } catch (e: any) {
      console.error(`[fetch-photos] Error:`, e);
      res.status(500).json({ error: `Server error: ${e.message}` });
    }
  });

  // Save image URLs directly (user pastes image links)
  app.post("/api/listings/:id/save-image-urls", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const listing = storage.getListing(Number(req.params.id), userId);
    if (!listing) return void res.status(404).json({ error: "Listing not found" });
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return void res.status(400).json({ error: "Provide an array of image URLs" });
    }
    const validUrls = urls.filter((u: string) => typeof u === "string" && u.startsWith("http"));
    if (validUrls.length === 0) {
      return void res.status(400).json({ error: "No valid image URLs found" });
    }
    const imageUrl = JSON.stringify(validUrls);
    const updated = storage.updateListing(Number(req.params.id), { imageUrl } as any, userId);
    res.json({ images: validUrls, listing: updated });
  });

  // === IMPORT DEPOP LISTING ===
  app.post("/api/depop/import", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { url, costPrice } = req.body;
    if (!url) return void res.status(400).json({ error: "Depop listing URL required" });
    try {
      const { fetchDepopListing } = await import("./marketSearch");
      const data = await fetchDepopListing(url);
      if (!data) return void res.status(404).json({ error: "Could not fetch listing from Depop" });

      const imageUrl = data.images.length > 0 ? JSON.stringify(data.images) : null;
      const listing = storage.createListing({
        title: data.title,
        description: data.description,
        brand: data.brand,
        size: data.size,
        condition: data.condition || "good",
        category: data.category || "Other",
        imageUrl,
        costPrice: Number(costPrice) || 0,
        listedPrice: data.price || null,
        platform: "depop",
        depopUrl: url,
        status: "active",
      } as any, userId);

      res.json(listing);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === SYNC LISTING FROM LIVE MARKETPLACE URLS ===
  // Fetches current price + description from each linked platform URL and updates the listing
  app.post("/api/listings/:id/sync-from-platform", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const listing = storage.getListing(Number(req.params.id), userId);
      if (!listing) return void res.status(404).json({ error: "Listing not found" });

      const sources: Record<string, any> = {};
      const errors: Record<string, string> = {};

      // Fetch from each linked platform in parallel
      const fetches: Promise<void>[] = [];

      if ((listing as any).depopUrl) {
        fetches.push(
          fetchDepopListing((listing as any).depopUrl)
            .then(d => { if (d) sources.depop = d; })
            .catch(e => { errors.depop = e.message; })
        );
      }
      if ((listing as any).vintedUrl) {
        fetches.push(
          fetchVintedListing((listing as any).vintedUrl)
            .then(d => { if (d) sources.vinted = d; })
            .catch(e => { errors.vinted = e.message; })
        );
      }
      if ((listing as any).ebayUrl) {
        fetches.push(
          fetchEbayListing((listing as any).ebayUrl)
            .then(d => { if (d) sources.ebay = d; })
            .catch(e => { errors.ebay = e.message; })
        );
      }

      await Promise.all(fetches);

      if (Object.keys(sources).length === 0) {
        const errorDetail = Object.entries(errors).map(([p, e]) => `${p}: ${e}`).join("; ");
        return void res.status(404).json({
          error: "No linked platform URLs found or could not fetch any. Link this listing to a platform first.",
          errors,
        });
      }

      // Build updates: prefer the platform the listing is "primary" on,
      // then fall back to whichever returned data
      const primaryPlatform = listing.platform as string;
      const primaryData = sources[primaryPlatform] || sources.depop || sources.vinted || sources.ebay;

      const updates: any = {};

      if (primaryData?.price && primaryData.price > 0) {
        updates.listedPrice = primaryData.price;
      }
      if (primaryData?.description && primaryData.description.length > 10) {
        updates.description = primaryData.description;
      }
      if (primaryData?.title && primaryData.title.length > 2) {
        updates.title = primaryData.title;
      }
      // Mark as sold if the primary platform says so
      if (primaryData?.status === "sold" && listing.status === "active") {
        updates.status = "sold";
      }

      const updatedListing = Object.keys(updates).length > 0
        ? storage.updateListing(Number(req.params.id), updates, userId)
        : listing;

      res.json({
        success: true,
        applied: Object.keys(updates),
        sources: Object.fromEntries(
          Object.entries(sources).map(([platform, d]) => [platform, {
            price: d.price,
            title: d.title?.slice(0, 60),
            description: d.description?.slice(0, 120),
            status: d.status,
          }])
        ),
        errors,
        listing: updatedListing,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === AUTO-LINK CROSS PLATFORM ===
  app.post("/api/listings/:id/auto-link", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const listing = storage.getListing(Number(req.params.id), userId);
      if (!listing) return void res.status(404).json({ error: "Listing not found" });

      // We search other platforms using the exact title
      // Usually, query without quotes is better for Vinted/Depop, then we filter by exact match
      const marketData = await searchAllPlatforms(listing.title);
      
      const updates: any = {};
      const t = listing.title.toLowerCase().trim();
      
      for (const results of marketData) {
        if (results.platform === "vinted" && !listing.vintedUrl) {
           const match = results.listings.find(l => l.title.toLowerCase().trim() === t);
           if (match && match.url) updates.vintedUrl = match.url;
        }
        if (results.platform === "ebay" && !listing.ebayUrl) {
           const match = results.listings.find(l => l.title.toLowerCase().trim() === t);
           if (match && match.url) updates.ebayUrl = match.url;
        }
      }

      if (Object.keys(updates).length > 0) {
        const updatedListing = storage.updateListing(Number(req.params.id), updates, userId);
        res.json({ success: true, linked: Object.keys(updates), listing: updatedListing });
      } else {
        res.json({ success: true, linked: [], message: "No exact matches found on other platforms." });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === DEAL FINDER ===

  // Hardcoded fallback trends shown when AI is unavailable
  const FALLBACK_TRENDS = {
    trends: [
      { query: "vintage Carhartt jacket", category: "clothing", buyPrice: { low: 8, high: 25 }, resalePrice: { low: 60, high: 180 }, demand: "high", trendReason: "Workwear revival on TikTok, huge on Depop Gen Z", platforms: ["depop", "ebay"] },
      { query: "Nike Dunk Low", category: "sneakers", buyPrice: { low: 30, high: 80 }, resalePrice: { low: 120, high: 300 }, demand: "high", trendReason: "Still the hottest silhouette, panda colorway especially", platforms: ["ebay", "depop"] },
      { query: "Y2K baby tee", category: "clothing", buyPrice: { low: 2, high: 8 }, resalePrice: { low: 25, high: 70 }, demand: "high", trendReason: "2000s nostalgia is peaking, graphic tees sell fast", platforms: ["depop", "vinted"] },
      { query: "vintage Levi's 501", category: "clothing", buyPrice: { low: 5, high: 20 }, resalePrice: { low: 45, high: 120 }, demand: "high", trendReason: "Timeless classic, vintage washes always in demand", platforms: ["depop", "ebay"] },
      { query: "Polo Ralph Lauren sweater", category: "clothing", buyPrice: { low: 5, high: 15 }, resalePrice: { low: 35, high: 90 }, demand: "medium", trendReason: "Prep revival, cable knits and rugby stripes trending", platforms: ["depop", "ebay"] },
      { query: "Patagonia fleece", category: "clothing", buyPrice: { low: 10, high: 30 }, resalePrice: { low: 50, high: 150 }, demand: "high", trendReason: "Retro Snap-T fleeces are gorpcore staples", platforms: ["depop", "ebay"] },
      { query: "Coach leather bag vintage", category: "accessories", buyPrice: { low: 8, high: 25 }, resalePrice: { low: 60, high: 180 }, demand: "high", trendReason: "Vintage Coach leather resurgence, Y2K aesthetic", platforms: ["depop", "vinted"] },
      { query: "Nintendo game vintage", category: "collectibles", buyPrice: { low: 3, high: 15 }, resalePrice: { low: 25, high: 150 }, demand: "medium", trendReason: "Retro gaming collectors pay premium for CIB games", platforms: ["ebay"] },
      { query: "vintage band tee 90s", category: "clothing", buyPrice: { low: 3, high: 20 }, resalePrice: { low: 40, high: 250 }, demand: "high", trendReason: "Single stitch band tees are grails, huge markup", platforms: ["depop", "ebay"] },
      { query: "Doc Martens 1460", category: "clothing", buyPrice: { low: 10, high: 30 }, resalePrice: { low: 50, high: 120 }, demand: "medium", trendReason: "Classic silhouette never goes out, vintage made in England versions premium", platforms: ["depop", "vinted"] },
    ],
    insight: "Vintage workwear, Y2K, and sneakers are dominating resale right now. Look for branded items at thrift stores.",
  };

  // Get trending categories for reselling
  app.get("/api/deals/trending", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const client = getAI();
      const prompt = `You are an expert reseller who knows the current secondhand fashion and goods market inside out.

Based on current trends in resale (Depop, Vinted, eBay) as of 2024-2025, provide 8-10 trending search queries that have HIGH demand and good flip potential. Focus on items that:
1. Are commonly found at thrift stores / garage sales / flea markets for cheap
2. Have strong demand online with big price markup potential
3. Are currently trending on TikTok, Instagram, or resale platforms

Mix categories: vintage clothing, sneakers, accessories, electronics, collectibles, home goods.

For each query, provide a specific search term (not generic), the typical thrift/buy price, typical resale price, and why it's trending.

Respond with ONLY raw JSON, no markdown fences, no extra text:
{
  "trends": [
    {
      "query": "specific search term for marketplace",
      "category": "clothing|sneakers|accessories|electronics|collectibles|home",
      "buyPrice": { "low": 3, "high": 15 },
      "resalePrice": { "low": 30, "high": 80 },
      "demand": "high",
      "trendReason": "short reason why this is hot right now",
      "platforms": ["depop", "ebay"]
    }
  ],
  "insight": "one sentence about the current resale market"
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const parsed = safeParseJSON(text);
      if (!parsed || !Array.isArray(parsed.trends) || parsed.trends.length === 0) {
        console.warn("[deals/trending] AI parsing failed, returning fallback trends");
        return void res.json(FALLBACK_TRENDS);
      }
      res.json(parsed);
    } catch (e: any) {
      console.error("[deals/trending] Error:", e.message);
      // Always return fallback on error so the UI is never empty
      res.json(FALLBACK_TRENDS);
    }
  });

  // Search for underpriced deals across platforms
  app.post("/api/deals/search", async (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { query, category } = req.body;
    if (!query) return void res.status(400).json({ error: "Search query required" });
    try {
      // Search all platforms in parallel
      const marketData = await searchAllPlatforms(query);

      // Get eBay sold prices as the "true market value" baseline
      const ebayData = marketData.find(m => m.platform === "ebay");
      const ebayMedian = ebayData?.medianPrice || 0;
      const ebayAvg = ebayData?.avgPrice || 0;
      const marketValue = ebayMedian > 0 ? ebayMedian : ebayAvg;

      // Collect all active listings from non-eBay platforms with their URLs
      const activeListings: Array<MarketListing & { discount: number; marketValue: number }> = [];

      for (const platformData of marketData) {
        if (platformData.platform === "ebay") continue; // eBay is our baseline
        for (const listing of platformData.listings) {
          if (!listing.price || listing.price <= 0) continue;
          if (listing.sold) continue;

          // Calculate discount vs market value
          const referencePrice = marketValue > 0 ? marketValue : platformData.medianPrice;
          if (referencePrice <= 0) continue;

          const discount = Math.round(((referencePrice - listing.price) / referencePrice) * 100);
          if (discount >= 25) { // At least 25% below market value
            activeListings.push({
              ...listing,
              discount,
              marketValue: referencePrice,
            });
          }
        }
      }

      // Sort by discount (biggest bargains first)
      activeListings.sort((a, b) => b.discount - a.discount);
      const topDeals = activeListings.slice(0, 20);

      // Use AI to analyze the deals and add context
      const client = getAI();
      const dealsContext = topDeals.length > 0
        ? topDeals.slice(0, 10).map((d, i) =>
            `${i + 1}. "${d.title}" on ${d.platform} for $${d.price} (market value ~$${d.marketValue}, ${d.discount}% below market)${d.url ? ` URL: ${d.url}` : ""}`
          ).join("\n")
        : "No significantly underpriced listings found.";

      const ebayContext = ebayData && ebayData.soldCount > 0
        ? `eBay sold data: ${ebayData.soldCount} items sold, avg $${ebayData.avgPrice}, median $${ebayData.medianPrice}, range $${ebayData.minPrice}-$${ebayData.maxPrice}`
        : "No eBay sold data available.";

      const prompt = `You are an expert reseller analyzing potential deals found on resale platforms.

Search query: "${query}"
Category: ${category || "general"}

REAL MARKET DATA:
${ebayContext}

${marketData.filter(m => m.platform !== "ebay" && m.avgPrice > 0).map(m =>
  `${m.platform.toUpperCase()}: ${m.listings.length} active listings, avg $${m.avgPrice}, median $${m.medianPrice}`
).join("\n")}

POTENTIAL DEALS FOUND (listings priced below market value):
${dealsContext}

Analyze these deals and the overall market for "${query}". Consider:
1. Is this item category currently trending?
2. How fast do these items typically sell?
3. Are the "deals" genuinely underpriced or is the market value inflated?
4. What's the realistic profit after platform fees?

Respond in JSON:
{
  "trendScore": 8,
  "demandLevel": "high|medium|low",
  "avgFlipProfit": { "low": 15, "high": 40 },
  "marketSummary": "2-3 sentence summary of the market for this item",
  "bestPlatformToBuy": "vinted",
  "bestPlatformToSell": "depop",
  "tips": ["tip1", "tip2"],
  "dealRatings": [
    {
      "index": 0,
      "rating": "great|good|okay|risky",
      "note": "why this specific deal is good or risky"
    }
  ],
  "searchSuggestions": ["related search 1", "related search 2"]
}`;

      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const analysis = safeParseJSON(text);

      res.json({
        query,
        deals: topDeals.map((d, i) => ({
          title: d.title,
          platform: d.platform,
          price: d.price,
          marketValue: d.marketValue,
          discount: d.discount,
          url: d.url || null,
          condition: d.condition || null,
          size: d.size || null,
          rating: analysis?.dealRatings?.find((r: any) => r.index === i)?.rating || null,
          ratingNote: analysis?.dealRatings?.find((r: any) => r.index === i)?.note || null,
        })),
        marketData: {
          ebay: ebayData ? {
            soldCount: ebayData.soldCount,
            avgPrice: ebayData.avgPrice,
            medianPrice: ebayData.medianPrice,
            minPrice: ebayData.minPrice,
            maxPrice: ebayData.maxPrice,
          } : null,
          platforms: marketData.filter(m => m.avgPrice > 0).map(m => ({
            platform: m.platform,
            avgPrice: m.avgPrice,
            medianPrice: m.medianPrice,
            count: m.platform === "ebay" ? m.soldCount : m.listings.length,
            type: m.platform === "ebay" ? "sold" : "active",
          })),
        },
        analysis: analysis || null,
        totalFound: activeListings.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Save a deal
  app.post("/api/deals/save", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    try {
      const { query, platform, title, price, marketPrice, discount, url, analysis } = req.body;
      if (!title || !platform || !price) return void res.status(400).json({ error: "Missing required fields" });
      const deal = storage.createSavedDeal({
        query: query || title,
        platform,
        title,
        price: Number(price),
        marketPrice: Number(marketPrice),
        discount: Number(discount),
        url: url || null,
        analysis: analysis || null,
        status: "saved",
      }, userId);
      res.json(deal);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Get saved deals
  app.get("/api/deals/saved", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    res.json(storage.getSavedDeals(userId));
  });

  // Update deal status
  app.patch("/api/deals/:id", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const { status } = req.body;
    if (!status) return void res.status(400).json({ error: "Status required" });
    const deal = storage.updateSavedDealStatus(Number(req.params.id), status, userId);
    if (!deal) return void res.status(404).json({ error: "Deal not found" });
    res.json(deal);
  });

  // Delete a saved deal
  app.delete("/api/deals/:id", (req, res) => {
    const userId = requireAuth(req, res);
    if (!userId) return;
    storage.deleteSavedDeal(Number(req.params.id), userId);
    res.json({ success: true });
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
