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
