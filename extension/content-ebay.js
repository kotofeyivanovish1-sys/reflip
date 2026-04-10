// ReFlip Sync — eBay Content Script
// Scrapes listing data from the user's eBay seller pages

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scrape_page" || msg.action === "scrape_all") {
    scrapeEbayListings().then(sendResponse).catch((e) =>
      sendResponse({ error: e.message, listings: [], platform: "ebay" })
    );
    return true;
  }
});

async function scrapeEbayListings() {
  const url = window.location.href;
  const listings = [];

  // ── Single listing page ──
  if (url.includes("/itm/")) {
    const item = scrapeEbayItemPage();
    if (item) listings.push(item);
    return { listings, platform: "ebay" };
  }

  // ── Seller's active listings / My eBay ──
  await autoScroll();

  // Try structured data first (JSON-LD)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (data["@type"] === "ItemList" && data.itemListElement) {
        for (const el of data.itemListElement) {
          const product = el.item || el;
          if (product.url) {
            listings.push({
              title: product.name || "",
              description: product.description || "",
              price: parseFloat(product.offers?.price || product.price || "0"),
              brand: product.brand?.name || null,
              size: null,
              condition: null,
              status: "active",
              images: product.image ? (Array.isArray(product.image) ? product.image : [product.image]) : [],
              url: product.url,
            });
          }
        }
        if (listings.length > 0) return { listings, platform: "ebay" };
      }
    } catch {}
  }

  // Fallback: scrape listing cards from seller page
  const cards = document.querySelectorAll('.s-item, .srp-results .s-item__wrapper, [data-view="mi:1686|iid"], .listing-item');
  const seen = new Set();

  for (const card of cards) {
    const link = card.querySelector('a.s-item__link, a[href*="/itm/"]');
    if (!link) continue;
    const href = link.getAttribute("href")?.split("?")?.[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const titleEl = card.querySelector('.s-item__title, .lvtitle, [role="heading"]');
    let title = titleEl?.textContent?.trim() || "";
    if (title === "Shop on eBay" || title === "Results matching fewer words") continue;

    const priceEl = card.querySelector('.s-item__price, .lvprice .bold, .s-item__detail--primaryInfo');
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0";

    const img = card.querySelector('img.s-item__image-img, img[src*="ebayimg.com"]');
    const imgSrc = img?.src || "";
    const images = [];
    if (imgSrc && !imgSrc.includes("gif")) {
      // Upgrade to large eBay image
      images.push(imgSrc.replace(/s-l\d+/, "s-l1600").replace(/s-l\d+\./, "s-l1600."));
    }

    const condEl = card.querySelector('.SECONDARY_INFO, .s-item__subtitle');
    const condition = condEl?.textContent?.trim() || null;

    listings.push({
      title,
      description: "",
      price: parseFloat(priceText) || 0,
      brand: null,
      size: null,
      condition,
      status: "active",
      images,
      url: href,
    });
  }

  // Also try My eBay selling page format
  if (listings.length === 0) {
    const rows = document.querySelectorAll('tr[class*="item"], .my-ebay-item, [data-test-id*="listing"]');
    for (const row of rows) {
      const link = row.querySelector('a[href*="/itm/"]');
      if (!link) continue;
      const href = link.getAttribute("href")?.split("?")?.[0];
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const title = link.textContent?.trim() || row.querySelector('[class*="title"]')?.textContent?.trim() || "";
      const priceEl = row.querySelector('[class*="price"], [class*="Price"]');
      const price = parseFloat(priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0");
      const img = row.querySelector('img[src*="ebayimg"]');
      const images = img?.src ? [img.src.replace(/s-l\d+/, "s-l1600")] : [];

      listings.push({
        title, description: "", price, brand: null, size: null,
        condition: null, status: "active", images, url: href,
      });
    }
  }

  return { listings, platform: "ebay" };
}

function scrapeEbayItemPage() {
  try {
    const images = [];

    // JSON-LD structured data
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data["@type"] === "Product" || data.name) {
          const imgArr = Array.isArray(data.image) ? data.image : data.image ? [data.image] : [];
          images.push(...imgArr);
          return {
            title: data.name || "",
            description: data.description || "",
            price: parseFloat(data.offers?.price || "0"),
            brand: data.brand?.name || null,
            size: null,
            condition: data.offers?.itemCondition?.replace("https://schema.org/", "") || null,
            status: data.offers?.availability?.includes("InStock") ? "active" : "sold",
            images,
            url: window.location.href.split("?")?.[0],
          };
        }
      } catch {}
    }

    // Fallback: DOM scraping
    const title = document.querySelector('h1.x-item-title__mainTitle, h1[itemprop="name"], .it-ttl')?.textContent?.trim() ||
                  document.querySelector('meta[property="og:title"]')?.content || document.title;

    const priceEl = document.querySelector('[itemprop="price"], .x-price-primary, #prcIsum');
    const price = parseFloat(priceEl?.getAttribute("content") || priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0");

    const desc = document.querySelector('meta[property="og:description"]')?.content || "";
    const brand = document.querySelector('[itemprop="brand"] [itemprop="name"]')?.textContent?.trim() || null;
    const condEl = document.querySelector('[data-testid="x-item-condition"] .ux-textual-display, .condText, [itemprop="itemCondition"]');
    const condition = condEl?.textContent?.trim() || null;

    // Images
    document.querySelectorAll('meta[property="og:image"]').forEach((m) => {
      if (m.content && !images.includes(m.content)) images.push(m.content);
    });
    document.querySelectorAll('img[src*="ebayimg.com"]').forEach((img) => {
      const src = (img.src || "").replace(/s-l\d+/, "s-l1600");
      if (src && !images.includes(src) && !src.includes(".gif")) images.push(src);
    });

    return {
      title, description: desc, price, brand, size: null, condition,
      status: "active", images,
      url: window.location.href.split("?")?.[0],
    };
  } catch { return null; }
}

async function autoScroll() {
  let lastHeight = document.body.scrollHeight;
  for (let i = 0; i < 20; i++) {
    window.scrollBy(0, 800);
    await new Promise((r) => setTimeout(r, 500));
    if (document.body.scrollHeight === lastHeight) break;
    lastHeight = document.body.scrollHeight;
  }
  window.scrollTo(0, 0);
}
