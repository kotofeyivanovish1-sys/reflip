import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, like } from "drizzle-orm";
import * as schema from "../shared/schema";
import { listings, scanResults, platformStats, users, bags } from "../shared/schema";
import type { InsertListing, Listing, InsertScanResult, ScanResult, InsertPlatformStat, PlatformStat, User, Bag } from "../shared/schema";
import bcrypt from "bcryptjs";

const sqlite = new Database("reflip.db");
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS bags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bag_number INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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

// Add new columns if they don't exist (for existing DBs)
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN scan_data TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN notes TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE listings ADD COLUMN bag_number INTEGER`); } catch {}

// Seed demo data if listings table is empty
const existingCount = db.select().from(listings).all().length;
if (existingCount === 0) {
  const now = new Date();
  const demoListings = [
    { title: "Vintage Levi's 501 Jeans W32 L30", description: "Classic 90s cut in great condition.", brand: "Levi's", size: "W32", condition: "good", category: "Jeans", costPrice: 8, status: "sold", platform: "depop", listedPrice: 45, soldPrice: 42, soldAt: "2026-03-10", createdAt: "2026-02-20", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Patagonia Fleece Jacket M", description: "Warm and minimal, great for outdoors.", brand: "Patagonia", size: "M", condition: "very good", category: "Jacket", costPrice: 12, status: "sold", platform: "depop", listedPrice: 65, soldPrice: 60, soldAt: "2026-03-15", createdAt: "2026-03-01", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Ralph Lauren Polo Shirt L Navy", description: "Classic navy polo, lightly worn.", brand: "Ralph Lauren", size: "L", condition: "good", category: "Shirt", costPrice: 5, status: "sold", platform: "depop", listedPrice: 30, soldPrice: 28, soldAt: "2026-03-18", createdAt: "2026-03-05", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Tommy Hilfiger Windbreaker M", description: "90s vibes, barely worn.", brand: "Tommy Hilfiger", size: "M", condition: "very good", category: "Jacket", costPrice: 10, status: "sold", platform: "vinted", listedPrice: 40, soldPrice: 38, soldAt: "2026-03-20", createdAt: "2026-03-08", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Vintage Band Tee Nirvana XL", description: "Authentic 90s Nirvana tour tee.", brand: "Vintage", size: "XL", condition: "good", category: "T-shirt", costPrice: 4, status: "sold", platform: "depop", listedPrice: 55, soldPrice: 50, soldAt: "2026-03-22", createdAt: "2026-03-10", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "North Face Puffer Jacket S", description: "600-fill, great warmth, no tears.", brand: "The North Face", size: "S", condition: "good", category: "Jacket", costPrice: 15, status: "sold", platform: "depop", listedPrice: 70, soldPrice: 65, soldAt: "2026-03-25", createdAt: "2026-03-12", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Levi's Denim Trucker Jacket M", description: "Medium wash, perfect vintage find.", brand: "Levi's", size: "M", condition: "good", category: "Jacket", costPrice: 9, status: "sold", platform: "depop", listedPrice: 55, soldPrice: 52, soldAt: "2026-03-28", createdAt: "2026-03-15", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Coach Leather Bag Brown", description: "Genuine leather, classic Coach design.", brand: "Coach", size: "One Size", condition: "very good", category: "Bag", costPrice: 18, status: "sold", platform: "depop", listedPrice: 85, soldPrice: 80, soldAt: "2026-03-30", createdAt: "2026-03-18", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Adidas Trefoil Hoodie L Grey", description: "Classic trefoil logo, thick cotton.", brand: "Adidas", size: "L", condition: "good", category: "Hoodie", costPrice: 6, status: "active", platform: "depop", listedPrice: 35, soldPrice: null, soldAt: null, createdAt: "2026-04-01", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Calvin Klein Jeans W30 Slim", description: "90s slim fit, medium wash.", brand: "Calvin Klein", size: "W30", condition: "good", category: "Jeans", costPrice: 7, status: "active", platform: "vinted", listedPrice: 28, soldPrice: null, soldAt: null, createdAt: "2026-04-02", aiTexts: null, priceSuggestions: null, imageUrl: null },
    { title: "Nike Air Max 90 US10", description: "Great soles, minor creasing on toe.", brand: "Nike", size: "US10", condition: "good", category: "Shoes", costPrice: 20, status: "active", platform: "depop", listedPrice: 80, soldPrice: null, soldAt: null, createdAt: "2026-04-03", aiTexts: null, priceSuggestions: null, imageUrl: null },
  ];
  for (const l of demoListings) {
    sqlite.prepare(`INSERT INTO listings (title,description,brand,size,condition,category,cost_price,status,platform,listed_price,sold_price,sold_at,created_at,ai_texts,price_suggestions,image_url,scan_data,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(l.title, l.description, l.brand, l.size, l.condition, l.category, l.costPrice, l.status, l.platform, l.listedPrice, l.soldPrice, l.soldAt, l.createdAt, l.aiTexts, l.priceSuggestions, l.imageUrl, null, null);
  }
}

export interface IStorage {
  // Users
  createUser(email: string, password: string, name?: string): Promise<Omit<User, 'passwordHash'>>;
  getUserByEmail(email: string): User | undefined;
  verifyUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null>;
  // Bags
  getBags(): (Bag & { item?: Listing })[]; 
  getBag(bagNumber: number): (Bag & { item?: Listing }) | undefined;
  getNextBagNumber(): number;
  assignBagToListing(listingId: number): number; // returns new bag number
  // Listings
  getListings(status?: string, platform?: string): Listing[];
  getListing(id: number): Listing | undefined;
  createListing(data: InsertListing): Listing;
  updateListing(id: number, data: Partial<InsertListing>): Listing | undefined;
  deleteListing(id: number): void;
  // Scan results
  createScanResult(data: InsertScanResult): ScanResult;
  getScanResults(): ScanResult[];
  // Stats
  getDashboardStats(): { totalRevenue: number; totalProfit: number; totalItems: number; activeListings: number; soldItems: number; avgProfit: number; platformBreakdown: any[]; recentSales: Listing[]; monthlySales: any[] };
  getPlatformAnalytics(): any;
}

class SQLiteStorage implements IStorage {
  async createUser(email: string, password: string, name?: string): Promise<Omit<User, 'passwordHash'>> {
    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const result = sqlite.prepare(`INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?) RETURNING id, email, name, created_at`).get(email, hash, name || null, now) as any;
    return result;
  }

  getUserByEmail(email: string): User | undefined {
    return sqlite.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as User | undefined;
  }

  async verifyUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null> {
    const row = sqlite.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
    if (!row) return null;
    const hash = row.password_hash;
    if (!hash) return null;
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return null;
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
  }

  getBags(): (Bag & { item?: Listing })[] {
    const allBags = sqlite.prepare(`SELECT * FROM bags ORDER BY bag_number ASC`).all() as Bag[];
    const allListings = db.select().from(listings).all();
    return allBags.map(bag => ({
      ...bag,
      item: allListings.find(l => l.bagNumber === bag.bagNumber),
    }));
  }

  getBag(bagNumber: number): (Bag & { item?: Listing }) | undefined {
    const bag = sqlite.prepare(`SELECT * FROM bags WHERE bag_number = ?`).get(bagNumber) as Bag | undefined;
    if (!bag) return undefined;
    const item = db.select().from(listings).all().find(l => l.bagNumber === bagNumber);
    return { ...bag, item };
  }

  getNextBagNumber(): number {
    const row = sqlite.prepare(`SELECT MAX(bag_number) as max FROM bags`).get() as { max: number | null };
    return (row.max || 0) + 1;
  }

  assignBagToListing(listingId: number): number {
    const bagNumber = this.getNextBagNumber();
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO bags (bag_number, created_at) VALUES (?, ?)`).run(bagNumber, now);
    sqlite.prepare(`UPDATE listings SET bag_number = ? WHERE id = ?`).run(bagNumber, listingId);
    return bagNumber;
  }

  getListings(status?: string, platform?: string): Listing[] {
    let query = db.select().from(listings);
    const rows = db.select().from(listings).all();
    if (status && platform) return rows.filter(r => r.status === status && r.platform === platform);
    if (status) return rows.filter(r => r.status === status);
    if (platform) return rows.filter(r => r.platform === platform);
    return rows;
  }

  getListing(id: number): Listing | undefined {
    return db.select().from(listings).where(eq(listings.id, id)).get();
  }

  createListing(data: InsertListing): Listing {
    const now = new Date().toISOString().split("T")[0];
    // Auto-assign next bag number — every item gets its own bag
    const bagNumber = this.getNextBagNumber();
    const bagNow = new Date().toISOString();
    sqlite.prepare(`INSERT INTO bags (bag_number, created_at) VALUES (?, ?)`).run(bagNumber, bagNow);

    const result = sqlite.prepare(`INSERT INTO listings (title,description,brand,size,condition,category,cost_price,status,platform,listed_price,sold_price,sold_at,created_at,ai_texts,price_suggestions,image_url,scan_data,notes,bag_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).get(
      data.title || "Untitled", data.description || data.title || "—", data.brand ?? null, data.size ?? null, data.condition, data.category ?? null, data.costPrice, data.status ?? "active", data.platform, data.listedPrice ?? null, data.soldPrice ?? null, data.soldAt ?? null, now, data.aiTexts ?? null, data.priceSuggestions ?? null, data.imageUrl ?? null, (data as any).scanData ?? null, (data as any).notes ?? null, bagNumber
    ) as Listing;
    return result;
  }

  updateListing(id: number, data: Partial<InsertListing>): Listing | undefined {
    const current = this.getListing(id);
    if (!current) return undefined;
    const fields = Object.keys(data) as (keyof InsertListing)[];
    if (fields.length === 0) return current;
    const colMap: Record<string, string> = {
      title: "title", description: "description", brand: "brand", size: "size", condition: "condition", category: "category", costPrice: "cost_price", status: "status", platform: "platform", listedPrice: "listed_price", soldPrice: "sold_price", soldAt: "sold_at", createdAt: "created_at", aiTexts: "ai_texts", priceSuggestions: "price_suggestions", imageUrl: "image_url", scanData: "scan_data", notes: "notes", bagNumber: "bag_number"
    };
    const setClauses = fields.map(f => `${colMap[f] || f} = ?`).join(", ");
    const values = fields.map(f => (data as any)[f]);
    sqlite.prepare(`UPDATE listings SET ${setClauses} WHERE id = ?`).run(...values, id);
    return this.getListing(id);
  }

  deleteListing(id: number): void {
    sqlite.prepare("DELETE FROM listings WHERE id = ?").run(id);
  }

  createScanResult(data: InsertScanResult): ScanResult {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`INSERT INTO scan_results (query, image_url, analysis, created_at) VALUES (?,?,?,?) RETURNING *`).get(
      data.query, data.imageUrl ?? null, data.analysis, now
    ) as ScanResult;
    return result;
  }

  getScanResults(): ScanResult[] {
    return db.select().from(scanResults).all().reverse();
  }

  getDashboardStats() {
    const all = db.select().from(listings).all();
    const sold = all.filter(l => l.status === "sold");
    const active = all.filter(l => l.status === "active");

    const totalRevenue = sold.reduce((sum, l) => sum + (l.soldPrice || 0), 0);
    const totalCost = sold.reduce((sum, l) => sum + l.costPrice, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgProfit = sold.length > 0 ? totalProfit / sold.length : 0;

    // Platform breakdown
    const platforms = ["depop", "vinted", "poshmark", "ebay"];
    const platformBreakdown = platforms.map(p => {
      const pSold = sold.filter(l => l.platform === p);
      const pActive = active.filter(l => l.platform === p);
      const rev = pSold.reduce((s, l) => s + (l.soldPrice || 0), 0);
      const cost = pSold.reduce((s, l) => s + l.costPrice, 0);
      return { platform: p, sales: pSold.length, revenue: rev, profit: rev - cost, active: pActive.length };
    }).filter(p => p.sales > 0 || p.active > 0);

    // Monthly sales (last 6 months)
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

  getPlatformAnalytics() {
    const all = db.select().from(listings).all();
    const sold = all.filter(l => l.status === "sold");
    const platforms = ["depop", "vinted"];
    return platforms.map(p => {
      const pAll = all.filter(l => l.platform === p);
      const pSold = sold.filter(l => l.platform === p);
      const rev = pSold.reduce((s, l) => s + (l.soldPrice || 0), 0);
      const cost = pSold.reduce((s, l) => s + l.costPrice, 0);
      const avgMargin = pSold.length > 0 ? ((rev - cost) / rev * 100) : 0;
      return { platform: p, totalItems: pAll.length, soldItems: pSold.length, activeItems: pAll.filter(l => l.status === "active").length, revenue: rev, profit: rev - cost, avgMargin: Math.round(avgMargin), topCategories: getTopCategories(pSold) };
    });
  }
}

function getTopCategories(items: Listing[]) {
  const map: Record<string, number> = {};
  for (const i of items) if (i.category) map[i.category] = (map[i.category] || 0) + 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));
}

export const storage = new SQLiteStorage();
