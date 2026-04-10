// ReFlip Sync — Depop Content Script
// Runs on depop.com pages, scrapes listing data when asked by popup

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scrape_page" || msg.action === "scrape_all") {
    scrapeDepopListings().then(sendResponse).catch((e) =>
      sendResponse({ error: e.message, listings: [], platform: "depop" })
    );
    return true; // async response
  }
});

async function scrapeDepopListings() {
  const url = window.location.href;
  const listings = [];

  // ── Single product page ──
  if (url.includes("/products/")) {
    const item = scrapeDepopProductPage();
    if (item) listings.push(item);
    return { listings, platform: "depop" };
  }

  // ── Shop/closet page (e.g. depop.com/@username) ──
  // Scroll to load more items, then scrape all product cards
  if (url.match(/depop\.com\/@/)) {
    // Auto-scroll to load all listings
    await autoScroll();
    const cards = document.querySelectorAll('a[href*="/products/"]');
    const seen = new Set();

    for (const card of cards) {
      const href = card.getAttribute("href");
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const item = scrapeDepopCard(card);
      if (item) listings.push(item);
    }

    return { listings, platform: "depop" };
  }

  // ── Selling page ──
  const cards = document.querySelectorAll('a[href*="/products/"]');
  const seen = new Set();
  for (const card of cards) {
    const href = card.getAttribute("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const item = scrapeDepopCard(card);
    if (item) listings.push(item);
  }

  return { listings, platform: "depop" };
}

function scrapeDepopProductPage() {
  try {
    // Try __NEXT_DATA__ first
    const nextDataEl = document.querySelector("#__NEXT_DATA__");
    if (nextDataEl) {
      try {
        const nd = JSON.parse(nextDataEl.textContent);
        const product = nd?.props?.pageProps?.product;
        if (product) {
          const images = [];
          if (product.pictures) {
            for (const p of product.pictures) {
              if (Array.isArray(p) && p.length > 0) {
                images.push(p[p.length - 1].url || p[0].url);
              } else if (p.url) {
                images.push(p.url);
              }
            }
          }
          return {
            title: product.description?.slice(0, 120) || product.slug || "",
            description: product.description || "",
            price: parseFloat(product.price?.priceAmount || product.preview_price_data?.priceAmount || "0"),
            brand: product.brand?.name || product.brand || null,
            size: product.size?.name || product.size || null,
            condition: product.condition || null,
            status: product.status === 1 ? "active" : product.sold ? "sold" : "active",
            images,
            url: window.location.href,
          };
        }
      } catch {}
    }

    // Fallback: scrape DOM directly
    const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
    const price = document.querySelector('meta[property="og:price:amount"]')?.content ||
                  document.querySelector('[data-testid*="price"]')?.textContent?.replace(/[^0-9.]/g, "");
    const images = [];
    document.querySelectorAll('meta[property="og:image"]').forEach((m) => {
      if (m.content) images.push(m.content);
    });
    // Also grab all product images visible on page
    document.querySelectorAll('img[src*="media-photos.depop.com"]').forEach((img) => {
      const src = img.src || img.getAttribute("data-src");
      if (src && !images.includes(src)) images.push(src);
    });

    return {
      title: title || "",
      description: "",
      price: parseFloat(price || "0"),
      brand: null,
      size: null,
      condition: null,
      status: "active",
      images,
      url: window.location.href,
    };
  } catch {
    return null;
  }
}

function scrapeDepopCard(card) {
  try {
    const href = card.getAttribute("href");
    const fullUrl = href.startsWith("http") ? href : `https://www.depop.com${href}`;

    // Get image
    const img = card.querySelector("img");
    const imgSrc = img?.src || img?.getAttribute("data-src") || "";
    const images = imgSrc ? [imgSrc] : [];

    // Get price — usually in a sibling or child element
    const priceEl = card.querySelector('[class*="Price"], [class*="price"]') ||
                    card.parentElement?.querySelector('[class*="Price"], [class*="price"]');
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0";

    // Get title from alt text or aria-label
    const title = img?.alt || card.getAttribute("aria-label") || "";

    return {
      title,
      description: "",
      price: parseFloat(priceText) || 0,
      brand: null,
      size: null,
      condition: null,
      status: "active",
      images,
      url: fullUrl,
    };
  } catch {
    return null;
  }
}

async function autoScroll() {
  const distance = 800;
  const maxScrolls = 30;
  let scrolls = 0;
  let lastHeight = document.body.scrollHeight;

  while (scrolls < maxScrolls) {
    window.scrollBy(0, distance);
    await new Promise((r) => setTimeout(r, 500));
    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
    scrolls++;
  }
  // Scroll back to top
  window.scrollTo(0, 0);
}
