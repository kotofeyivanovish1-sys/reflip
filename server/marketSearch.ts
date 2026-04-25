/**
 * Real-time market data from multiple resale platforms
 * eBay: sold listings (actual completed sales)
 * Vinted: active listings (sold items not public)
 * Depop: active listings via web search
 */

interface MarketListing {
  platform: string;
  title: string;
  price: number;
  condition?: string;
  size?: string;
  date?: string;
  url?: string;
  sold: boolean;
}

interface MarketData {
  platform: string;
  listings: MarketListing[];
  soldCount: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  sampleTitles: string[];
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function emptyMarketData(platform: string): MarketData {
  return { platform, listings: [], soldCount: 0, avgPrice: 0, minPrice: 0, maxPrice: 0, medianPrice: 0, sampleTitles: [] };
}

// Collect all Set-Cookie values from a response
function extractCookies(res: Response): string {
  const cookies: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value.split(";")[0].trim());
    }
  });
  return cookies.join("; ");
}

// eBay — searches SOLD (completed) listings via HTML parsing
async function searchEbay(query: string, size?: string): Promise<MarketData> {
  const searchQuery = size ? `${query} ${size}` : query;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Sold=1&LH_Complete=1&_sacat=11450`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) return emptyMarketData("ebay");
    const html = await res.text();
    const listings = parseEbaySold(html);

    const prices = listings.map(l => l.price).filter(p => p > 2);
    return {
      platform: "ebay",
      listings: listings.slice(0, 20),
      soldCount: listings.length,
      avgPrice: Math.round(avg(prices) * 100) / 100,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      sampleTitles: listings.slice(0, 5).map(l => l.title),
    };
  } catch {
    return emptyMarketData("ebay");
  }
}

function parseEbaySold(content: string): MarketListing[] {
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  const text = content.replace(/<[^>]+>/g, "\n");
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 1);

  const items: MarketListing[] = [];
  for (let i = 0; i < lines.length; i++) {
    const soldMatch = lines[i].match(/^Sold\s+(\w+\s+\d+,\s+\d{4})/);
    if (soldMatch && i + 1 < lines.length) {
      const date = soldMatch[1];
      const title = lines[i + 1];
      let price: number | null = null;
      let condition: string | undefined;

      for (let j = i + 2; j < Math.min(i + 12, lines.length); j++) {
        const priceMatch = lines[j].match(/^\$(\d+\.?\d*)$/);
        if (priceMatch) { price = parseFloat(priceMatch[1]); break; }
        if (/Pre-Owned|New|Used/i.test(lines[j])) condition = lines[j].replace(/·/g, "").trim();
      }

      if (price && price > 2 && title.length > 10 && !title.includes("eBay")) {
        items.push({ platform: "ebay", title, price, date, condition, sold: true });
      }
    }
  }
  return items;
}

// Vinted — active listings via API with proper session cookie handling
async function searchVinted(query: string, size?: string): Promise<MarketData> {
  try {
    // Step 1: Get session cookies from the homepage (required by Vinted API)
    const initRes = await fetch("https://www.vinted.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const cookieString = extractCookies(initRes);

    // Step 2: Query the catalog API with those cookies
    const params = new URLSearchParams({
      search_text: size ? `${query} ${size}` : query,
      per_page: "20",
      currency: "USD",
      order: "relevance",
    });

    const res = await fetch(`https://www.vinted.com/api/v2/catalog/items?${params}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.vinted.com/",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookieString,
      },
    });

    if (!res.ok) {
      console.error(`[searchVinted] API returned ${res.status}`);
      return emptyMarketData("vinted");
    }

    const data = await res.json();
    if (!data.items || !Array.isArray(data.items)) {
      console.error("[searchVinted] Unexpected response shape:", JSON.stringify(data).slice(0, 200));
      return emptyMarketData("vinted");
    }

    const listings: MarketListing[] = data.items.map((item: any) => ({
      platform: "vinted",
      title: item.title || "",
      price: parseFloat(item.price?.amount ?? item.price ?? "0"),
      condition: item.status,
      size: item.size_title,
      url: item.url ? `https://www.vinted.com${item.url}` : undefined,
      sold: false,
    }));

    const prices = listings.map(l => l.price).filter(p => p > 0);
    return {
      platform: "vinted",
      listings: listings.slice(0, 20),
      soldCount: 0,
      avgPrice: Math.round(avg(prices) * 100) / 100,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      sampleTitles: listings.slice(0, 5).map(l => l.title),
    };
  } catch (e) {
    console.error("[searchVinted] Error:", e);
    return emptyMarketData("vinted");
  }
}

// Depop — active listings, tries API then page scrape as fallback
async function searchDepop(query: string, size?: string): Promise<MarketData> {
  const searchQ = size ? `${query} ${size}` : query;

  // Attempt 1: Depop web API
  try {
    const res = await fetch(
      `https://webapi.depop.com/api/v2/search/products/?q=${encodeURIComponent(searchQ)}&itemsPerPage=20&country=gb&currency=GBP`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "application/json",
          "Accept-Language": "en-GB,en;q=0.9",
          "Referer": "https://www.depop.com/",
          "Origin": "https://www.depop.com",
          "depop-user-country": "GB",
          "depop-user-currency": "GBP",
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      if (data.products && data.products.length > 0) {
        const listings: MarketListing[] = data.products
          .filter((p: any) => p.preview_price_data?.priceAmount)
          .map((p: any) => ({
            platform: "depop",
            title: p.description || p.slug || "",
            price: parseFloat(p.preview_price_data.priceAmount),
            condition: p.condition,
            size: p.size,
            url: `https://www.depop.com/products/${p.slug}/`,
            sold: false,
          }));

        const prices = listings.map(l => l.price).filter(p => p > 0);
        if (prices.length > 0) {
          return {
            platform: "depop",
            listings: listings.slice(0, 20),
            soldCount: 0,
            avgPrice: Math.round(avg(prices) * 100) / 100,
            minPrice: prices.length ? Math.min(...prices) : 0,
            maxPrice: prices.length ? Math.max(...prices) : 0,
            medianPrice: Math.round(median(prices) * 100) / 100,
            sampleTitles: listings.slice(0, 5).map(l => l.title),
          };
        }
      }
    } else {
      console.error(`[searchDepop] API returned ${res.status}`);
    }
  } catch (e) {
    console.error("[searchDepop] API attempt failed:", e);
  }

  // Attempt 2: Parse __NEXT_DATA__ from the search page
  try {
    const pageRes = await fetch(
      `https://www.depop.com/search/?q=${encodeURIComponent(searchQ)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );

    if (pageRes.ok) {
      const html = await pageRes.text();
      const nextDataMatch = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const nd = JSON.parse(nextDataMatch[1]);
        const products: any[] =
          nd?.props?.pageProps?.searchState?.results?.products ||
          nd?.props?.pageProps?.data?.products ||
          nd?.props?.pageProps?.products ||
          [];

        const listings: MarketListing[] = products
          .filter((p: any) => p.price?.priceAmount || p.preview_price_data?.priceAmount)
          .map((p: any) => ({
            platform: "depop",
            title: p.description || p.slug || "",
            price: parseFloat(p.price?.priceAmount ?? p.preview_price_data?.priceAmount ?? "0"),
            condition: p.condition,
            size: p.size,
            url: `https://www.depop.com/products/${p.slug}/`,
            sold: false,
          }));

        const prices = listings.map(l => l.price).filter(p => p > 0);
        if (prices.length > 0) {
          return {
            platform: "depop",
            listings: listings.slice(0, 20),
            soldCount: 0,
            avgPrice: Math.round(avg(prices) * 100) / 100,
            minPrice: prices.length ? Math.min(...prices) : 0,
            maxPrice: prices.length ? Math.max(...prices) : 0,
            medianPrice: Math.round(median(prices) * 100) / 100,
            sampleTitles: listings.slice(0, 5).map(l => l.title),
          };
        }
      }
    } else {
      console.error(`[searchDepop] Page returned ${pageRes.status}`);
    }
  } catch (e) {
    console.error("[searchDepop] Page scrape failed:", e);
  }

  return emptyMarketData("depop");
}

export async function searchAllPlatforms(query: string, size?: string): Promise<MarketData[]> {
  const [ebay, vinted, depop] = await Promise.allSettled([
    searchEbay(query, size),
    searchVinted(query, size),
    searchDepop(query, size),
  ]);

  return [
    ebay.status === "fulfilled" ? ebay.value : emptyMarketData("ebay"),
    vinted.status === "fulfilled" ? vinted.value : emptyMarketData("vinted"),
    depop.status === "fulfilled" ? depop.value : emptyMarketData("depop"),
  ];
}

export interface ScrapedListingData {
  title: string;
  description: string;
  price: number;
  brand: string | null;
  size: string | null;
  condition: string | null;
  category: string | null;
  images: string[];
  url: string;
  status?: string;
}

export { searchEbay, searchVinted, searchDepop, emptyMarketData };
export type { MarketData, MarketListing };

// ─── Single listing fetchers ──────────────────────────────────────────────────

export async function fetchVintedListing(listingUrl: string): Promise<ScrapedListingData | null> {
  const idMatch = listingUrl.match(/\/items\/(\d+)/);
  if (!idMatch) return null;
  const itemId = idMatch[1];

  let host = "www.vinted.com";
  try { host = new URL(listingUrl).hostname; } catch {}

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    // 1) Try Vinted internal API
    const res = await fetch(`https://${host}/api/v2/items/${itemId}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": `https://${host}/`,
      },
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const item = data.item || data;
      if (item.id) {
        const images: string[] = [];
        const photos = item.photos || (item.photo ? [item.photo] : []);
        for (const photo of photos) {
          const url = photo.full_size_url || photo.url || "";
          if (url) images.push(url);
        }
        return {
          title: item.title || "",
          description: item.description || "",
          price: parseFloat(item.price?.amount ?? item.price ?? "0"),
          brand: item.brand_title || item.brand?.title || null,
          size: item.size_title || item.size?.title || null,
          condition: item.status || null,
          category: item.category?.title || null,
          images,
          url: listingUrl,
          status: item.is_closed || item.is_hidden ? "sold" : "active",
        };
      }
    }

    // 2) Fallback: HTML page → JSON-LD
    const pageRes = await fetch(listingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!pageRes.ok) throw new Error(`Vinted returned HTTP ${pageRes.status}`);
    const html = await pageRes.text();

    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld.name || ld["@type"] === "Product") {
          const images: string[] = Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [];
          return {
            title: ld.name || "",
            description: ld.description || "",
            price: parseFloat(ld.offers?.price || "0"),
            brand: ld.brand?.name || null,
            size: null,
            condition: ld.offers?.itemCondition?.replace("https://schema.org/", "") || null,
            category: null,
            images,
            url: listingUrl,
            status: ld.offers?.availability?.includes("InStock") ? "active" : "sold",
          };
        }
      } catch {}
    }

    // 3) og tags fallback
    const title = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] || "";
    const description = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] || "";
    const priceMatch = html.match(/<meta[^>]+property="og:price:amount"[^>]+content="([^"]+)"/i);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const images = imageMatch ? [imageMatch[1]] : [];

    return { title, description, price, brand: null, size: null, condition: null, category: null, images, url: listingUrl, status: "active" };
  } catch (e: any) {
    clearTimeout(timer);
    console.error(`[fetchVintedListing] Failed for ${listingUrl}: ${e.message}`);
    return null;
  }
}

export async function fetchDepopListing(listingUrl: string): Promise<ScrapedListingData | null> {
  const slugMatch = listingUrl.match(/products\/([A-Za-z0-9_.-]+)/);
  const slug = slugMatch ? slugMatch[1] : listingUrl.replace(/\/$/, "").split("/").pop();
  if (!slug) throw new Error("Could not extract product slug from Depop URL");

  const attempts: string[] = [];
  let apiData: any = null;
  const images: string[] = [];

  // 1) Try Depop v2 API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://webapi.depop.com/api/v2/products/${slug}/`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://www.depop.com/",
        "Origin": "https://www.depop.com",
        "depop-user-country": "US",
        "depop-user-currency": "USD",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      apiData = await res.json();
      const pics = apiData.pictures || apiData.images || [];
      for (const p of pics) {
        if (Array.isArray(p) && p.length > 0) {
          const best = p[p.length - 1];
          images.push(typeof best === "string" ? best : best.url);
        } else if (p.url) {
          images.push(p.url);
        } else if (typeof p === "string" && p.startsWith("http")) {
          images.push(p);
        }
      }
    } else {
      attempts.push(`v2 API: ${res.status}`);
    }
  } catch (e: any) {
    attempts.push(`v2 API failed: ${e.message}`);
  }

  // 2) Try HTML page scraping if no images yet
  if (images.length === 0) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const htmlRes = await fetch(`https://www.depop.com/products/${slug}/`, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const nextData = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextData) {
          const nd = JSON.parse(nextData[1]);
          const product = nd?.props?.pageProps?.product || nd?.props?.pageProps?.data?.product;
          if (product) {
            if (!apiData) apiData = product;
            for (const p of product.pictures || []) {
              if (Array.isArray(p) && p.length > 0) {
                const best = p[p.length - 1];
                images.push(typeof best === "string" ? best : best.url);
              } else if (p.url) {
                images.push(p.url);
              }
            }
          }
        }
        if (images.length === 0) {
          const ogRegex = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi;
          let m;
          while ((m = ogRegex.exec(html)) !== null) {
            if (!images.includes(m[1])) images.push(m[1]);
          }
        }
        if (images.length === 0) {
          const imgRegex = /https:\/\/media-photos\.depop\.com\/[^\s"']+/g;
          let m;
          while ((m = imgRegex.exec(html)) !== null) {
            const clean = m[0].replace(/&amp;/g, "&");
            if (!images.includes(clean)) images.push(clean);
          }
        }
      } else {
        attempts.push(`Page: ${htmlRes.status}`);
      }
    } catch (e: any) {
      attempts.push(`Page failed: ${e.message}`);
    }
  }

  // 3) v1 API fallback
  if (images.length === 0) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://webapi.depop.com/api/v1/products/${slug}/`, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "application/json",
          "Referer": "https://www.depop.com/",
        },
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (!apiData) apiData = data;
        for (const p of data.pictures || data.images || []) {
          if (Array.isArray(p) && p.length > 0) {
            const best = p[p.length - 1];
            images.push(typeof best === "string" ? best : best.url);
          } else if (p.url) {
            images.push(p.url);
          } else if (typeof p === "string" && p.startsWith("http")) {
            images.push(p);
          }
        }
      } else {
        attempts.push(`v1 API: ${res.status}`);
      }
    } catch (e: any) {
      attempts.push(`v1 API failed: ${e.message}`);
    }
  }

  if (images.length === 0) {
    console.error(`[fetchDepopListing] All attempts failed for ${slug}:`, attempts);
    throw new Error(`Could not fetch Depop photos: ${attempts.join("; ")}`);
  }

  return {
    title: apiData?.slug || apiData?.description?.slice(0, 80) || slug,
    description: apiData?.description || "",
    price: parseFloat(apiData?.price?.priceAmount ?? apiData?.preview_price_data?.priceAmount ?? "0"),
    brand: apiData?.brand?.name ?? apiData?.brand ?? null,
    size: apiData?.size?.name ?? apiData?.size ?? null,
    condition: apiData?.condition || null,
    category: apiData?.category?.name ?? apiData?.category ?? null,
    images,
    url: listingUrl,
    status: apiData?.sold ? "sold" : "active",
  };
}

export async function fetchEbayListing(listingUrl: string): Promise<ScrapedListingData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(listingUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`eBay returned HTTP ${res.status}`);
    const html = await res.text();

    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        if (ld["@type"] === "Product" || ld.name) {
          const images: string[] = Array.isArray(ld.image) ? ld.image : ld.image ? [ld.image] : [];
          return {
            title: ld.name || "",
            description: ld.description || "",
            price: parseFloat(ld.offers?.price || "0"),
            brand: ld.brand?.name || null,
            size: null,
            condition: ld.offers?.itemCondition?.replace("https://schema.org/", "") || null,
            category: null,
            images,
            url: listingUrl,
            status: ld.offers?.availability?.includes("InStock") ? "active" : "sold",
          };
        }
      } catch {}
    }

    const title = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]
      || html.match(/<h1[^>]*class="[^"]*x-item-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim()
      || "";
    const description = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] || "";
    const priceMatch = html.match(/itemprop="price"[^>]+content="([^"]+)"/i) || html.match(/class="[^"]*x-price-primary[^"]*"[^>]*>[\s\S]*?\$?([\d,.]+)/i);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0;
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const images = imageMatch ? [imageMatch[1]] : [];
    const isEnded = /listing ended|item sold|no longer available/i.test(html);

    return { title, description, price, brand: null, size: null, condition: null, category: null, images, url: listingUrl, status: isEnded ? "sold" : "active" };
  } catch (e: any) {
    clearTimeout(timer);
    console.error(`[fetchEbayListing] Failed for ${listingUrl}: ${e.message}`);
    return null;
  }
}
