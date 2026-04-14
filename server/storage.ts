import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { listings, scanResults, platformStats, users, bags, savedDeals } from "../shared/schema";
import type { InsertListing, Listing, InsertScanResult, ScanResult, InsertPlatformStat, PlatformStat, User, Bag, InsertSavedDeal, SavedDeal } from "../shared/schema";
import bcrypt from "bcryptjs";

// Use DB_PATH env var for Railway Volume, fallback for local dev
const dbPath = process.env.DB_PATH || "reflip.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

// Create tables (with user_id support from the start)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    brand TEXT,
    size TEXT,
    condition TEXT NOT NULL DEFAULT 'good',
    category TEXT,
    image_url TEXT,
    cost_price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    platform TEXT NOT NULL DEFAULT 'depop',
    listed_price REAL,
    sold_price REAL,
    sold_at TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    ai_texts TEXT,
    price_suggestions TEXT,
    scan_data TEXT,
    notes TEXT,
    bag_number INTEGER
  );

  CREATE TABLE IF NOT EXISTS bags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    bag_number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    query TEXT NOT NULL,
    image_url TEXT,
    analysis TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS platform_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    month TEXT NOT NULL,
    total_sales INTEGER NOT NULL DEFAULT 0,
    total_revenue REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    avg_days_to_sell REAL,
    updated_at TEXT NOT NULL DEFAULT ''
  );
`);

// Add new columns for existing DBs (migrations)
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN scan_data TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN notes TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN bag_number INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN user_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE scan_results ADD COLUMN user_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE bags ADD COLUMN user_id INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN depop_url TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN vinted_url TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN ebay_url TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN custom_background TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN depop_price REAL`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN vinted_price REAL`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN ebay_price REAL`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN last_auto_sync_at TEXT`); } catch {}

// saved_deals table for Deal Finder
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS saved_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    query TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    market_price REAL NOT NULL,
    discount INTEGER NOT NULL,
    url TEXT,
    analysis TEXT,
    status TEXT NOT NULL DEFAULT 'saved',
    created_at TEXT NOT NULL DEFAULT ''
  );
`);

// Migrate existing data: assign all unowned records to user id=1 (first user)
// This ensures the first person who registers gets all their existing data
try { sqlite.exec(`UPDATE listings SET user_id = 1 WHERE user_id IS NULL`); } catch {}
try { sqlite.exec(`UPDATE scan_results SET user_id = 1 WHERE user_id IS NULL`); } catch {}

// Seed admin user — recreated automatically if DB is wiped
try {
  sqlite.prepare(
    `INSERT OR IGNORE INTO users (email, password_hash, name, created_at)
     VALUES (?, ?, ?, date('now'))`
  ).run(
    "stpnv.me@icloud.com",
    "$2b$10$laaadRsI3T8b7djRGffhwu70xibwAAPsioa6kOBMGXvoJCQ7V6EOa",
    "Admin"
  );
} catch {}

// Map raw SQLite snake_case rows to camelCase Listing objects
function mapRow(row: any): Listing {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    title: row.title,
    description: row.description,
    brand: row.brand,
    size: row.size,
    condition: row.condition,
    category: row.category,
    imageUrl: row.image_url ?? row.imageUrl,
    costPrice: row.cost_price ?? row.costPrice ?? 0,
    status: row.status,
    platform: row.platform,
    listedPrice: row.listed_price ?? row.listedPrice ?? null,
    soldPrice: row.sold_price ?? row.soldPrice ?? null,
    soldAt: row.sold_at ?? row.soldAt ?? null,
    createdAt: row.created_at ?? row.createdAt,
    aiTexts: row.ai_texts ?? row.aiTexts ?? null,
    priceSuggestions: row.price_suggestions ?? row.priceSuggestions ?? null,
    scanData: row.scan_data ?? row.scanData ?? null,
    notes: row.notes ?? null,
    bagNumber: row.bag_number ?? row.bagNumber ?? null,
    depopUrl: row.depop_url ?? row.depopUrl ?? null,
    vintedUrl: row.vinted_url ?? row.vintedUrl ?? null,
    ebayUrl: row.ebay_url ?? row.ebayUrl ?? null,
    depopPrice: row.depop_price ?? row.depopPrice ?? null,
    vintedPrice: row.vinted_price ?? row.vintedPrice ?? null,
    ebayPrice: row.ebay_price ?? row.ebayPrice ?? null,
    lastAutoSyncAt: row.last_auto_sync_at ?? row.lastAutoSyncAt ?? null,
  } as Listing;
}

export interface IStorage {
  // Users
  createUser(email: string, password: string, name?: string): Promise<Omit<User, 'passwordHash'>>;
  getUserByEmail(email: string): User | undefined;
  verifyUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null>;
  // Bags
  getBags(userId: number): { bagNumber: number; item?: Listing }[];
  getBag(userId: number, bagNumber: number): { bagNumber: number; item?: Listing } | undefined;
  getNextBagNumber(userId: number): number;
  assignBagToListing(listingId: number, userId: number): number;
  // Listings
  getListings(userId: number, status?: string, platform?: string): Listing[];
  getListing(id: number, userId: number): Listing | undefined;
  createListing(data: InsertListing, userId: number): Listing;
  updateListing(id: number, data: Partial<InsertListing>, userId: number): Listing | undefined;
  deleteListing(id: number, userId: number): void;
  getAllActiveListingsWithUrls(): Listing[];
  // Scan results
  createScanResult(data: InsertScanResult, userId: number): ScanResult;
  getScanResults(userId: number): ScanResult[];
  // Deals
  getSavedDeals(userId: number): SavedDeal[];
  createSavedDeal(data: InsertSavedDeal, userId: number): SavedDeal;
  updateSavedDealStatus(id: number, status: string, userId: number): SavedDeal | undefined;
  deleteSavedDeal(id: number, userId: number): void;
  // Stats
  getDashboardStats(userId: number): {
    totalRevenue: number; totalProfit: number; totalItems: number;
    activeListings: number; soldItems: number; avgProfit: number;
    platformBreakdown: any[]; recentSales: Listing[]; monthlySales: any[];
  };
  getPlatformAnalytics(userId: number): any;
  updateUserBackground(userId: number, customBackground: string): void;
}

class SQLiteStorage implements IStorage {
  async createUser(email: string, password: string, name?: string): Promise<Omit<User, 'passwordHash'>> {
    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const result = sqlite.prepare(`INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?) RETURNING id, email, name, created_at, custom_background AS customBackground`).get(email, hash, name || null, now) as any;
    return result;
  }

  getUserByEmail(email: string): User | undefined {
    const row = sqlite.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
    if (!row) return undefined;
    return { ...row, customBackground: row.custom_background } as User;
  }

  async verifyUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null> {
    const row = sqlite.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
    if (!row) return null;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return null;
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at, customBackground: row.custom_background };
  }

  updateUserBackground(userId: number, customBackground: string): void {
    sqlite.prepare("UPDATE users SET custom_background = ? WHERE id = ?").run(customBackground, userId);
  }

  getBags(userId: number): { bagNumber: number; item?: Listing }[] {
    const userListings = sqlite.prepare(`SELECT * FROM listings WHERE user_id = ? AND bag_number IS NOT NULL ORDER BY bag_number ASC`).all(userId).map(mapRow);
    return userListings.map(l => ({ bagNumber: l.bagNumber!, item: l }));
  }

  getBag(userId: number, bagNumber: number): { bagNumber: number; item?: Listing } | undefined {
    const raw = sqlite.prepare(`SELECT * FROM listings WHERE user_id = ? AND bag_number = ? LIMIT 1`).get(userId, bagNumber) as any;
    if (!raw) return undefined;
    return { bagNumber, item: mapRow(raw) };
  }

  getNextBagNumber(userId: number): number {
    const row = sqlite.prepare(`SELECT MAX(bag_number) as max FROM listings WHERE user_id = ?`).get(userId) as { max: number | null };
    return (row.max || 0) + 1;
  }

  assignBagToListing(listingId: number, userId: number): number {
    const bagNumber = this.getNextBagNumber(userId);
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`INSERT INTO bags (user_id, bag_number, created_at) VALUES (?, ?, ?)`).run(userId, bagNumber, now);
    } catch {}
    sqlite.prepare(`UPDATE listings SET bag_number = ? WHERE id = ? AND user_id = ?`).run(bagNumber, listingId, userId);
    return bagNumber;
  }

  getListings(userId: number, status?: string, platform?: string): Listing[] {
    let query = `SELECT * FROM listings WHERE user_id = ?`;
    const params: any[] = [userId];
    if (status) { query += ` AND status = ?`; params.push(status); }
    if (platform) { query += ` AND platform = ?`; params.push(platform); }
    query += ` ORDER BY id DESC`;
    return sqlite.prepare(query).all(...params).map(mapRow);
  }

  getListing(id: number, userId: number): Listing | undefined {
    const raw = sqlite.prepare(`SELECT * FROM listings WHERE id = ? AND user_id = ?`).get(id, userId) as any;
    return raw ? mapRow(raw) : undefined;
  }

  createListing(data: InsertListing, userId: number): Listing {
    const now = new Date().toISOString().split("T")[0];
    const bagNumber = this.getNextBagNumber(userId);
    const bagNow = new Date().toISOString();
    try {
      sqlite.prepare(`INSERT INTO bags (user_id, bag_number, created_at) VALUES (?, ?, ?)`).run(userId, bagNumber, bagNow);
    } catch {}

    const result = sqlite.prepare(`
      INSERT INTO listings (user_id,title,description,brand,size,condition,category,cost_price,status,platform,listed_price,sold_price,sold_at,created_at,ai_texts,price_suggestions,image_url,scan_data,notes,bag_number,depop_url,vinted_url,ebay_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *
    `).get(
      userId,
      data.title || "Untitled", data.description || data.title || "—",
      data.brand ?? null, data.size ?? null, data.condition, data.category ?? null,
      data.costPrice, data.status ?? "active", data.platform,
      data.listedPrice ?? null, data.soldPrice ?? null, data.soldAt ?? null,
      now, data.aiTexts ?? null, data.priceSuggestions ?? null, data.imageUrl ?? null,
      (data as any).scanData ?? null, (data as any).notes ?? null, bagNumber,
      (data as any).depopUrl ?? null, (data as any).vintedUrl ?? null, (data as any).ebayUrl ?? null
    ) as any;
    return mapRow(result);
  }

  updateListing(id: number, data: Partial<InsertListing>, userId: number): Listing | undefined {
    const current = this.getListing(id, userId);
    if (!current) return undefined;
    const fields = Object.keys(data) as (keyof InsertListing)[];
    if (fields.length === 0) return current;
    const colMap: Record<string, string> = {
      title: "title", description: "description", brand: "brand", size: "size",
      condition: "condition", category: "category", costPrice: "cost_price",
      status: "status", platform: "platform", listedPrice: "listed_price",
      soldPrice: "sold_price", soldAt: "sold_at", createdAt: "created_at",
      aiTexts: "ai_texts", priceSuggestions: "price_suggestions", imageUrl: "image_url",
      scanData: "scan_data", notes: "notes", bagNumber: "bag_number", userId: "user_id",
      depopUrl: "depop_url", vintedUrl: "vinted_url", ebayUrl: "ebay_url",
      depopPrice: "depop_price", vintedPrice: "vinted_price", ebayPrice: "ebay_price",
      lastAutoSyncAt: "last_auto_sync_at",
    };
    const setClauses = fields.map(f => `${colMap[f] || f} = ?`).join(", ");
    const values = fields.map(f => (data as any)[f]);
    sqlite.prepare(`UPDATE listings SET ${setClauses} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
    return this.getListing(id, userId);
  }

  deleteListing(id: number, userId: number): void {
    sqlite.prepare("DELETE FROM listings WHERE id = ? AND user_id = ?").run(id, userId);
  }

  getAllActiveListingsWithUrls(): Listing[] {
    return sqlite.prepare(`
      SELECT * FROM listings
      WHERE status = 'active'
        AND (depop_url IS NOT NULL OR vinted_url IS NOT NULL OR ebay_url IS NOT NULL)
      ORDER BY id ASC
    `).all().map(mapRow);
  }

  createScanResult(data: InsertScanResult, userId: number): ScanResult {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`INSERT INTO scan_results (user_id, query, image_url, analysis, created_at) VALUES (?,?,?,?,?) RETURNING *`).get(
      userId, data.query, data.imageUrl ?? null, data.analysis, now
    ) as ScanResult;
    return result;
  }

  getScanResults(userId: number): ScanResult[] {
    return sqlite.prepare(`SELECT * FROM scan_results WHERE user_id = ? ORDER BY id DESC`).all(userId) as ScanResult[];
  }

  getSavedDeals(userId: number): SavedDeal[] {
    return sqlite.prepare(`SELECT * FROM saved_deals WHERE user_id = ? ORDER BY id DESC`).all(userId).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      query: row.query,
      platform: row.platform,
      title: row.title,
      price: row.price,
      marketPrice: row.market_price,
      discount: row.discount,
      url: row.url,
      analysis: row.analysis,
      status: row.status,
      createdAt: row.created_at,
    })) as SavedDeal[];
  }

  createSavedDeal(data: InsertSavedDeal, userId: number): SavedDeal {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO saved_deals (user_id, query, platform, title, price, market_price, discount, url, analysis, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *
    `).get(userId, data.query, data.platform, data.title, data.price, data.marketPrice, data.discount, data.url ?? null, data.analysis ?? null, data.status ?? 'saved', now) as any;
    return {
      id: result.id, userId: result.user_id, query: result.query, platform: result.platform,
      title: result.title, price: result.price, marketPrice: result.market_price, discount: result.discount,
      url: result.url, analysis: result.analysis, status: result.status, createdAt: result.created_at,
    } as SavedDeal;
  }

  updateSavedDealStatus(id: number, status: string, userId: number): SavedDeal | undefined {
    sqlite.prepare(`UPDATE saved_deals SET status = ? WHERE id = ? AND user_id = ?`).run(status, id, userId);
    const row = sqlite.prepare(`SELECT * FROM saved_deals WHERE id = ? AND user_id = ?`).get(id, userId) as any;
    if (!row) return undefined;
    return {
      id: row.id, userId: row.user_id, query: row.query, platform: row.platform,
      title: row.title, price: row.price, marketPrice: row.market_price, discount: row.discount,
      url: row.url, analysis: row.analysis, status: row.status, createdAt: row.created_at,
    } as SavedDeal;
  }

  deleteSavedDeal(id: number, userId: number): void {
    sqlite.prepare(`DELETE FROM saved_deals WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  getDashboardStats(userId: number) {
    const all = sqlite.prepare(`SELECT * FROM listings WHERE user_id = ?`).all(userId).map(mapRow);
    const sold = all.filter(l => l.status === "sold");
    const active = all.filter(l => l.status === "active");

    const totalRevenue = sold.reduce((sum, l) => sum + (l.soldPrice || 0), 0);
    const totalCost = sold.reduce((sum, l) => sum + l.costPrice, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgProfit = sold.length > 0 ? totalProfit / sold.length : 0;

    const platforms = ["depop", "vinted", "ebay"];
    const platformBreakdown = platforms.map(p => {
      const pSold = sold.filter(l => l.platform === p);
      const pActive = active.filter(l => l.platform === p);
      const rev = pSold.reduce((s, l) => s + (l.soldPrice || 0), 0);
      const cost = pSold.reduce((s, l) => s + l.costPrice, 0);
      return { platform: p, sales: pSold.length, revenue: rev, profit: rev - cost, active: pActive.length };
    }).filter(p => p.sales > 0 || p.active > 0);

    const monthMap: Record<string, { revenue: number; profit: number; sales: number }> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      monthMap[key] = { revenue: 0, profit: 0, sales: 0 };
    }
    for (const l of sold) {
      if (!l.soldAt) continue;
      const month = l.soldAt.slice(0, 7);
      if (monthMap[month]) {
        monthMap[month].revenue += l.soldPrice || 0;
        monthMap[month].profit += (l.soldPrice || 0) - l.costPrice;
        monthMap[month].sales += 1;
      }
    }
    const monthlySales = Object.entries(monthMap).map(([month, data]) => ({
      month,
      label: new Date(month + "-01").toLocaleString("en", { month: "short" }),
      ...data
    }));

    const recentSales = sold.sort((a, b) => (b.soldAt || "").localeCompare(a.soldAt || "")).slice(0, 5);

    return { totalRevenue, totalProfit, totalItems: all.length, activeListings: active.length, soldItems: sold.length, avgProfit, platformBreakdown, recentSales, monthlySales };
  }

  getPlatformAnalytics(userId: number) {
    const all = sqlite.prepare(`SELECT * FROM listings WHERE user_id = ?`).all(userId).map(mapRow);
    const sold = all.filter(l => l.status === "sold");
    const platforms = ["depop", "vinted", "ebay"];
    return platforms.map(p => {
      const pAll = all.filter(l => l.platform === p);
      const pSold = sold.filter(l => l.platform === p);
      const rev = pSold.reduce((s, l) => s + (l.soldPrice || 0), 0);
      const cost = pSold.reduce((s, l) => s + l.costPrice, 0);
      const avgMargin = pSold.length > 0 ? ((rev - cost) / rev * 100) : 0;
      return {
        platform: p, totalItems: pAll.length, soldItems: pSold.length,
        activeItems: pAll.filter(l => l.status === "active").length,
        revenue: rev, profit: rev - cost, avgMargin: Math.round(avgMargin),
        topCategories: getTopCategories(pSold),
      };
    });
  }
}

function getTopCategories(items: Listing[]) {
  const map: Record<string, number> = {};
  for (const i of items) if (i.category) map[i.category] = (map[i.category] || 0) + 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));
}

export const storage = new SQLiteStorage();
