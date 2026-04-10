/**
 * Real-time market data from multiple resale platforms
 * eBay: sold listings (actual completed sales)
 * Vinted: active listings (best available — sold items not public)
 * Depop: active listings via web search
 * Poshmark: active listings via web search
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

// eBay - searches SOLD (completed) listings
// Note: eBay HTML is fetched and parsed. May be blocked in some server environments.
async function searchEbay(query: string, size?: string): Promise<MarketData> {
  const searchQuery = size ? `${query} ${size}` : query;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Sold=1&LH_Complete=1&_sacat=11450`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
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
  } catch (e) {
    // eBay may block server requests in some environments
    return emptyMarketData("ebay");
  }
}

function parseEbaySold(content: string): MarketListing[] {
  // Remove scripts/styles
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Convert to text lines
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
      let size: string | undefined;

      for (let j = i + 2; j < Math.min(i + 12, lines.length); j++) {
        const priceMatch = lines[j].match(/^\$(\d+\.?\d*)$/);
        if (priceMatch) { price = parseFloat(priceMatch[1]); break; }
        if (/Pre-Owned|New|Used/i.test(lines[j])) condition = lines[j].replace(/·/g, "").trim();
        if (/Size|in x/i.test(lines[j])) size = lines[j];
      }

      if (price && price > 2 && title.length > 10 && !title.includes("eBay")) {
        items.push({ platform: "ebay", title, price, date, condition, size, sold: true });
      }
    }
  }
  return items;
}

// Vinted - active listings (sold items are not publicly accessible on Vinted)
async function searchVinted(query: string, size?: string): Promise<MarketData> {
  try {
    // Get session cookie first
    const init = await fetch("https://www.vinted.com/", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
    });
    const cookies = init.headers.get("set-cookie") || "";

    const params = new URLSearchParams({
      search_text: size ? `${query} ${size}` : query,
      per_page: "20",
      currency: "USD",
    });

    const res = await fetch(`https://www.vinted.com/api/v2/catalog/items?${params}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.vinted.com/",
        "Cookie": cookies,
      },
    });

    const data = await res.json();
    if (!data.items) return emptyMarketData("vinted");

    const listings: MarketListing[] = data.items.map((item: any) => ({
      platform: "vinted",
      title: item.title || "",
      price: parseFloat(item.price?.amount || "0"),
      condition: item.status,
      size: item.size_title,
      url: item.url,
      sold: false, // Vinted only shows active
    }));

    const prices = listings.map(l => l.price).filter(p => p > 0);
    return {
      platform: "vinted",
      listings: listings.slice(0, 20),
      soldCount: 0, // Vinted doesn't expose sold
      avgPrice: Math.round(avg(prices) * 100) / 100,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      sampleTitles: listings.slice(0, 5).map(l => l.title),
    };
  } catch (e) {
    return emptyMarketData("vinted");
  }
}

// Depop - active listings via their web API
async function searchDepop(query: string, size?: string): Promise<MarketData> {
  try {
    const searchQ = size ? `${query} ${size}` : query;
    const res = await fetch(
      `https://webapi.depop.com/api/v2/search/products/?q=${encodeURIComponent(searchQ)}&itemsPerPage=20&country=us&currency=USD`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "depop-user-country": "US",
          "depop-user-currency": "USD",
        },
      }
    );

    if (!res.ok) return emptyMarketData("depop");
    const data = await res.json();
    if (!data.products) return emptyMarketData("depop");

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
  } catch (e) {
    return emptyMarketData("depop");
  }
}

// Poshmark - active listings
async function searchPoshmark(query: string): Promise<MarketData> {
  try {
    const res = await fetch(
      `https://poshmark.com/search?query=${encodeURIComponent(query)}&type=listings`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    const html = await res.text();
    
    // Poshmark embeds data in __NEXT_DATA__
    const jsonMatch = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!jsonMatch) return emptyMarketData("poshmark");

    const data = JSON.parse(jsonMatch[1]);
    const props = data?.props?.pageProps;
    
    // Try different paths for listings
    let posts = props?.posts || props?.searchResults?.posts || props?.data?.posts || [];
    if (!Array.isArray(posts)) posts = [];

    const listings: MarketListing[] = posts
      .filter((p: any) => p?.price_amount?.val || p?.price)
      .slice(0, 20)
      .map((p: any) => ({
        platform: "poshmark",
        title: p.title || p.description || "",
        price: parseFloat(p.price_amount?.val || p.price || "0"),
        condition: p.condition,
        size: p.size,
        url: p.id ? `https://poshmark.com/listing/${p.id}` : undefined,
        sold: false,
      }));

    const prices = listings.map(l => l.price).filter(p => p > 0);
    return {
      platform: "poshmark",
      listings,
      soldCount: 0,
      avgPrice: Math.round(avg(prices) * 100) / 100,
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      medianPrice: Math.round(median(prices) * 100) / 100,
      sampleTitles: listings.slice(0, 5).map(l => l.title),
    };
  } catch (e) {
    return emptyMarketData("poshmark");
  }
}

function emptyMarketData(platform: string): MarketData {
  return { platform, listings: [], soldCount: 0, avgPrice: 0, minPrice: 0, maxPrice: 0, medianPrice: 0, sampleTitles: [] };
}

// Fetch a single Poshmark listing page — extracts photos, title, price, description, etc.
export interface ScrapedListingData {
  title: string;
  description: string;
  price: number;
  brand: string | null;
  size: string | null;
  condition: string | null;
  category: string | null;
  images: string[];  // full-res image URLs
  url: string;
}

export async function fetchPoshmarkListing(listingUrl: string): Promise<ScrapedListingData | null> {
  let url = listingUrl.trim();
  if (!url.startsWith("http")) {
    url = `https://poshmark.com/listing/${url}`;
  }

  const attempts: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let html = "";
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Poshmark returned HTTP ${res.status}`);
    html = await res.text();
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(`Could not fetch Poshmark page: ${e.message}`);
  }

  const images: string[] = [];
  let listingData: any = null;

  // 1) Try __NEXT_DATA__ JSON
  const jsonMatch = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const props = data?.props?.pageProps;
      listingData = props?.listing || props?.data?.listing || props?.post || props?.data?.post || null;

      if (listingData) {
        const pics = listingData.pictures || listingData.photos || listingData.cover_shot_pictures || [];
        for (const pic of pics) {
          const imgUrl = pic.url_original || pic.url_full || pic.url_large || pic.url || pic;
          if (typeof imgUrl === "string" && imgUrl.startsWith("http")) images.push(imgUrl);
        }
        if (listingData.cover_shot?.url_original || listingData.cover_shot?.url_full) {
          const coverUrl = listingData.cover_shot.url_original || listingData.cover_shot.url_full;
          if (!images.includes(coverUrl)) images.unshift(coverUrl);
        }
      } else {
        attempts.push("__NEXT_DATA__ found but listing object missing");
      }
    } catch { attempts.push("__NEXT_DATA__ JSON parse failed"); }
  } else {
    attempts.push("No __NEXT_DATA__ in HTML");
  }

  // 2) Fallback: og:image meta tags
  if (images.length === 0) {
    const ogRegex = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi;
    let ogMatch;
    while ((ogMatch = ogRegex.exec(html)) !== null) {
      if (ogMatch[1] && !images.includes(ogMatch[1])) images.push(ogMatch[1]);
    }
    if (images.length === 0) attempts.push("No og:image meta tags found");
  }

  // 3) Fallback: Poshmark CDN URLs in HTML
  if (images.length === 0) {
    const cdnRegex = /https:\/\/di2ponv0v5otw\.cloudfront\.net\/[^\s"']+/g;
    let cdnMatch;
    while ((cdnMatch = cdnRegex.exec(html)) !== null) {
      const clean = cdnMatch[0].replace(/&amp;/g, "&");
      if (!images.includes(clean)) images.push(clean);
    }
    if (images.length === 0) attempts.push("No CDN image URLs in HTML");
  }

  if (images.length === 0) {
    console.error(`[fetchPoshmarkListing] No images found:`, attempts);
    throw new Error(`Poshmark page loaded but no images found: ${attempts.join("; ")}`);
  }

  return {
    title: listingData?.title || listingData?.display_title || "",
    description: listingData?.description || "",
    price: parseFloat(listingData?.price_amount?.val || listingData?.original_price_amount?.val || listingData?.price || "0"),
    brand: listingData?.brand?.name || listingData?.brand_name || listingData?.brand || null,
    size: listingData?.size?.display || listingData?.size_display || listingData?.size || null,
    condition: listingData?.condition || listingData?.inventory?.condition || null,
    category: listingData?.category_v2?.display || listingData?.department?.display || listingData?.category || null,
    images,
    url,
  };
}

export async function searchAllPlatforms(query: string, size?: string): Promise<MarketData[]> {
  const [ebay, vinted, depop, poshmark] = await Promise.allSettled([
    searchEbay(query, size),
    searchVinted(query, size),
    searchDepop(query, size),
    searchPoshmark(query),
  ]);

  return [
    ebay.status === "fulfilled" ? ebay.value : emptyMarketData("ebay"),
    vinted.status === "fulfilled" ? vinted.value : emptyMarketData("vinted"),
    depop.status === "fulfilled" ? depop.value : emptyMarketData("depop"),
    poshmark.status === "fulfilled" ? poshmark.value : emptyMarketData("poshmark"),
  ];
}

export async function fetchDepopListing(listingUrl: string): Promise<ScrapedListingData | null> {
  const slugMatch = listingUrl.match(/products\/([A-Za-z0-9_.-]+)/);
  const slug = slugMatch ? slugMatch[1] : listingUrl.replace(/\/$/, "").split('/').pop();
  if (!slug) throw new Error("Could not extract product slug from Depop URL");

  const attempts: string[] = [];
  let apiData: any = null;
  const images: string[] = [];

  // 1) Try Depop API
  try {
    const prodUrl = `https://webapi.depop.com/api/v2/products/${slug}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(prodUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "depop-user-country": "US",
        "depop-user-currency": "USD"
      }
    });
    clearTimeout(timer);
    if (res.ok) {
      apiData = await res.json();
      const pics = apiData.pictures || apiData.images || apiData.preview?.images || [];
      if (Array.isArray(pics)) {
        for (const p of pics) {
          if (Array.isArray(p) && p.length > 0) {
            const best = p[p.length - 1];
            const imgUrl = typeof best === "string" ? best : best.url;
            if (imgUrl) images.push(imgUrl);
          } else if (p.url) {
            images.push(p.url);
          } else if (typeof p === "string" && p.startsWith("http")) {
            images.push(p);
          }
        }
      }
      if (images.length === 0) attempts.push(`API ok but no images in response (keys: ${Object.keys(apiData).join(",")})`);
    } else {
      attempts.push(`API returned ${res.status}`);
    }
  } catch (e: any) {
    attempts.push(`API failed: ${e.message}`);
  }

  // 2) Try HTML page scraping
  if (images.length === 0) {
    try {
      const pageUrl = `https://www.depop.com/products/${slug}/`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const htmlRes = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (htmlRes.ok) {
        const html = await htmlRes.text();

        // Try __NEXT_DATA__
        const nextData = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextData) {
          try {
            const nd = JSON.parse(nextData[1]);
            const product = nd?.props?.pageProps?.product || nd?.props?.pageProps?.data?.product;
            if (product?.pictures) {
              for (const p of product.pictures) {
                if (Array.isArray(p) && p.length > 0) {
                  const best = p[p.length - 1];
                  const imgUrl = typeof best === "string" ? best : best.url;
                  if (imgUrl) images.push(imgUrl);
                } else if (p.url) {
                  images.push(p.url);
                }
              }
            }
          } catch {}
        }

        // Fallback: og:image
        if (images.length === 0) {
          const ogRegex = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi;
          let m;
          while ((m = ogRegex.exec(html)) !== null) {
            if (m[1] && !images.includes(m[1])) images.push(m[1]);
          }
        }

        // Fallback: CDN URLs
        if (images.length === 0) {
          const imgRegex = /https:\/\/media-photos\.depop\.com\/[^\s"']+/g;
          let m;
          while ((m = imgRegex.exec(html)) !== null) {
            const clean = m[0].replace(/&amp;/g, "&");
            if (!images.includes(clean)) images.push(clean);
          }
        }

        if (images.length === 0) attempts.push("HTML page loaded but no images found");
      } else {
        attempts.push(`HTML page returned ${htmlRes.status}`);
      }
    } catch (e: any) {
      attempts.push(`HTML page failed: ${e.message}`);
    }
  }

  if (images.length === 0) {
    console.error(`[fetchDepopListing] All attempts failed for ${slug}:`, attempts);
    throw new Error(`Could not fetch Depop photos: ${attempts.join("; ")}`);
  }

  return {
    title: apiData?.slug || apiData?.description?.slice(0, 80) || slug || "",
    description: apiData?.description || "",
    price: parseFloat(apiData?.price?.priceAmount || apiData?.preview_price_data?.priceAmount || "0"),
    brand: apiData?.brand?.name || apiData?.brand || null,
    size: apiData?.size?.name || apiData?.size || null,
    condition: apiData?.condition || null,
    category: apiData?.category?.name || apiData?.category || null,
    images,
    url: listingUrl
  };
}
