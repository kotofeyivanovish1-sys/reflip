import cron from "node-cron";
import { storage } from "./storage";
import { fetchDepopListing, fetchVintedListing, fetchEbayListing } from "./marketSearch";
import type { Listing } from "../shared/schema";

const SYNC_INTERVAL_HOURS = 2;

async function syncOneListing(listing: Listing): Promise<void> {
  const updates: Record<string, any> = {};

  if (listing.depopUrl) {
    try {
      const data = await fetchDepopListing(listing.depopUrl);
      if (data) {
        if (data.price && data.price > 0) updates.depopPrice = data.price;
        if (data.title && data.title.length > 2) updates.title = data.title;
        if (data.description && data.description.length > 10) updates.description = data.description;
        if (data.brand && !listing.brand) updates.brand = data.brand;
        if (data.size && !listing.size) updates.size = data.size;
        // Detect sold status via Depop API — price of 0 or description absent often means removed
        if (!data.price || data.price === 0) {
          // Don't mark sold from price alone — Depop API sometimes returns 0 for available items
        }
      }
    } catch (e: any) {
      console.error(`[autoSync] Depop fetch failed for listing ${listing.id}: ${e.message}`);
    }
  }

  if (listing.vintedUrl) {
    try {
      const data = await fetchVintedListing(listing.vintedUrl);
      if (data) {
        if (data.price && data.price > 0) updates.vintedPrice = data.price;
        if (data.title && data.title.length > 2 && !updates.title) updates.title = data.title;
        if (data.description && data.description.length > 10 && !updates.description) updates.description = data.description;
        if (data.brand && !listing.brand && !updates.brand) updates.brand = data.brand;
        if (data.size && !listing.size && !updates.size) updates.size = data.size;
      }
    } catch (e: any) {
      console.error(`[autoSync] Vinted fetch failed for listing ${listing.id}: ${e.message}`);
    }
  }

  if (listing.ebayUrl) {
    try {
      const data = await fetchEbayListing(listing.ebayUrl);
      if (data) {
        if (data.price && data.price > 0) updates.ebayPrice = data.price;
        if (data.title && data.title.length > 2 && !updates.title) updates.title = data.title;
        if (data.description && data.description.length > 10 && !updates.description) updates.description = data.description;
      }
    } catch (e: any) {
      console.error(`[autoSync] eBay fetch failed for listing ${listing.id}: ${e.message}`);
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.lastAutoSyncAt = new Date().toISOString();
    storage.updateListing(listing.id, updates as any, listing.userId!);
    const changedFields = Object.keys(updates).filter(k => k !== "lastAutoSyncAt");
    console.log(`[autoSync] Updated listing ${listing.id} "${listing.title?.slice(0, 30)}": ${changedFields.join(", ")}`);
  }
}

export async function runAutoSync(): Promise<void> {
  const listings = storage.getAllActiveListingsWithUrls();
  if (listings.length === 0) {
    console.log("[autoSync] No active listings with platform URLs to sync");
    return;
  }
  console.log(`[autoSync] Starting sync for ${listings.length} listings...`);
  let updated = 0;
  for (const listing of listings) {
    try {
      const before = JSON.stringify({ depopPrice: (listing as any).depopPrice, vintedPrice: (listing as any).vintedPrice, ebayPrice: (listing as any).ebayPrice });
      await syncOneListing(listing);
      updated++;
    } catch (e: any) {
      console.error(`[autoSync] Error syncing listing ${listing.id}: ${e.message}`);
    }
    // Small delay between requests to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[autoSync] Sync complete. Processed ${updated}/${listings.length} listings.`);
}

export function startAutoSync(): void {
  // Run every 2 hours
  cron.schedule(`0 */${SYNC_INTERVAL_HOURS} * * *`, async () => {
    console.log(`[autoSync] Scheduled sync triggered at ${new Date().toISOString()}`);
    await runAutoSync();
  });
  console.log(`[autoSync] Auto-sync scheduled every ${SYNC_INTERVAL_HOURS} hours`);
}
