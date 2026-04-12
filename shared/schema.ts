import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// --- USERS ---
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  customBackground: text("custom_background"),
  createdAt: text("created_at").notNull().default(""),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// --- BAGS ---
export const bags = sqliteTable("bags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  bagNumber: integer("bag_number").notNull(),
  createdAt: text("created_at").notNull().default(""),
});
export const insertBagSchema = createInsertSchema(bags).omit({ id: true, createdAt: true });
export type InsertBag = z.infer<typeof insertBagSchema>;
export type Bag = typeof bags.$inferSelect;

// --- LISTINGS ---
export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  brand: text("brand"),
  size: text("size"),
  condition: text("condition").notNull().default("good"),
  category: text("category"),
  imageUrl: text("image_url"),
  costPrice: real("cost_price").notNull().default(0),
  status: text("status").notNull().default("active"), // active | sold | draft | pending
  platform: text("platform").notNull().default("depop"),
  listedPrice: real("listed_price"),
  soldPrice: real("sold_price"),
  soldAt: text("sold_at"),
  createdAt: text("created_at").notNull().default(""),
  aiTexts: text("ai_texts"),
  priceSuggestions: text("price_suggestions"),
  scanData: text("scan_data"),
  notes: text("notes"),
  bagNumber: integer("bag_number"),
  depopUrl: text("depop_url"),
  vintedUrl: text("vinted_url"),
  poshmarkUrl: text("poshmark_url"),
  ebayUrl: text("ebay_url"),
});

export const insertListingSchema = createInsertSchema(listings).omit({ id: true, createdAt: true });
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// --- SCAN RESULTS (Goodwill Scanner) ---
export const scanResults = sqliteTable("scan_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  query: text("query").notNull(),
  imageUrl: text("image_url"),
  analysis: text("analysis").notNull(),
  createdAt: text("created_at").notNull().default(""),
});

export const insertScanResultSchema = createInsertSchema(scanResults).omit({ id: true, createdAt: true });
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
export type ScanResult = typeof scanResults.$inferSelect;

// --- PLATFORM STATS ---
export const platformStats = sqliteTable("platform_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: text("platform").notNull(),
  month: text("month").notNull(),
  totalSales: integer("total_sales").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  avgDaysToSell: real("avg_days_to_sell"),
  updatedAt: text("updated_at").notNull().default(""),
});

export const insertPlatformStatSchema = createInsertSchema(platformStats).omit({ id: true });
export type InsertPlatformStat = z.infer<typeof insertPlatformStatSchema>;
export type PlatformStat = typeof platformStats.$inferSelect;

// --- SAVED DEALS (Deal Finder) ---
export const savedDeals = sqliteTable("saved_deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  query: text("query").notNull(),
  platform: text("platform").notNull(),
  title: text("title").notNull(),
  price: real("price").notNull(),
  marketPrice: real("market_price").notNull(),
  discount: integer("discount").notNull(),
  url: text("url"),
  analysis: text("analysis"),
  status: text("status").notNull().default("saved"), // saved | bought | skipped
  createdAt: text("created_at").notNull().default(""),
});

export const insertSavedDealSchema = createInsertSchema(savedDeals).omit({ id: true, createdAt: true });
export type InsertSavedDeal = z.infer<typeof insertSavedDealSchema>;
export type SavedDeal = typeof savedDeals.$inferSelect;
