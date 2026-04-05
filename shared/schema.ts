import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// --- USERS ---
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  createdAt: text("created_at").notNull().default(""),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// --- BAGS ---
export const bags = sqliteTable("bags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bagNumber: integer("bag_number").notNull().unique(), // #1, #2, #3...
  createdAt: text("created_at").notNull().default(""),
});
export const insertBagSchema = createInsertSchema(bags).omit({ id: true, createdAt: true });
export type InsertBag = z.infer<typeof insertBagSchema>;
export type Bag = typeof bags.$inferSelect;

// --- LISTINGS ---
export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  brand: text("brand"),
  size: text("size"),
  condition: text("condition").notNull().default("good"),
  category: text("category"),
  imageUrl: text("image_url"),
  costPrice: real("cost_price").notNull().default(0),
  status: text("status").notNull().default("active"), // active | sold | draft
  platform: text("platform").notNull().default("depop"), // depop | vinted | poshmark | ebay
  listedPrice: real("listed_price"),
  soldPrice: real("sold_price"),
  soldAt: text("sold_at"),
  createdAt: text("created_at").notNull().default(""),
  // AI-generated texts stored as JSON
  aiTexts: text("ai_texts"), // JSON: { depop: "...", vinted: "...", ... }
  // Price suggestions stored as JSON
  priceSuggestions: text("price_suggestions"), // JSON: { depop: 35, vinted: 30, ... }
  // Full scan analysis data (for pending items from scanner)
  scanData: text("scan_data"), // JSON: full AI scan result
  notes: text("notes"), // seller notes
  bagNumber: integer("bag_number"), // which physical bag this item is packed in
});

export const insertListingSchema = createInsertSchema(listings).omit({ id: true, createdAt: true });
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// --- SCAN RESULTS (Goodwill Scanner) ---
export const scanResults = sqliteTable("scan_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(), // item name or description
  imageUrl: text("image_url"),
  analysis: text("analysis").notNull(), // JSON: full AI analysis
  createdAt: text("created_at").notNull().default(""),
});

export const insertScanResultSchema = createInsertSchema(scanResults).omit({ id: true, createdAt: true });
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
export type ScanResult = typeof scanResults.$inferSelect;

// --- PLATFORM STATS ---
export const platformStats = sqliteTable("platform_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: text("platform").notNull(),
  month: text("month").notNull(), // YYYY-MM
  totalSales: integer("total_sales").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  avgDaysToSell: real("avg_days_to_sell"),
  updatedAt: text("updated_at").notNull().default(""),
});

export const insertPlatformStatSchema = createInsertSchema(platformStats).omit({ id: true });
export type InsertPlatformStat = z.infer<typeof insertPlatformStatSchema>;
export type PlatformStat = typeof platformStats.$inferSelect;
