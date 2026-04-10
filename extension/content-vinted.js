// ReFlip Sync — Vinted Content Script
// Scrapes listing data from the user's Vinted closet/wardrobe pages

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scrape_page" || msg.action === "scrape_all") {
    scrapeVintedListings().then(sendResponse).catch((e) =>
      sendResponse({ error: e.message, listings: [], platform: "vinted" })
    );
    return true;
  }
});

async function scrapeVintedListings() {
  const url = window.location.href;
  const listings = [];

  // ── Single item page ──
  if (url.match(/\/items\/\d+/)) {
    const item = await scrapeVintedItemPage();
    if (item) listings.push(item);
    return { listings, platform: "vinted" };
  }

  // ── Member wardrobe page ──
  const memberMatch = url.match(/\/member\/(\d+)\/items/) || url.match(/\/members\/(\d+)/);
  if (memberMatch) {
    const memberId = memberMatch[1];
    const apiListings = await fetchMemberItemsViaApi(memberId);
    if (apiListings.length > 0) return { listings: apiListings, platform: "vinted" };
  }

  // ── Closet / wardrobe page — try API via current user ──
  if (url.includes("/member/") || url.includes("/closet") || url.includes("/wardrobe")) {
    // Try to get member ID from the page
    const memberId = extractMemberId();
    if (memberId) {
      const apiListings = await fetchMemberItemsViaApi(memberId);
      if (apiListings.length > 0) return { listings: apiListings, platform: "vinted" };
    }
  }

  // Fallback: scroll and scrape item cards from DOM
  await autoScroll();
  const scraped = scrapeItemCards();
  if (scraped.length > 0) return { listings: scraped, platform: "vinted" };

  return { listings, platform: "vinted" };
}

function extractMemberId() {
  // Try URL patterns
  const urlMatch = window.location.href.match(/\/member\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // Try data attributes on the page
  const memberEl = document.querySelector('[data-member-id], [data-user-id]');
  if (memberEl) return memberEl.getAttribute('data-member-id') || memberEl.getAttribute('data-user-id');

  // Try __NEXT_DATA__ or similar embedded JSON
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent || "";
    const match = text.match(/"userId"\s*:\s*(\d+)/) || text.match(/"member_id"\s*:\s*(\d+)/);
    if (match) return match[1];
  }

  return null;
}

// Fetch items via Vinted's internal API (user is authenticated in browser)
async function fetchMemberItemsViaApi(memberId) {
  const listings = [];
  // Detect which Vinted domain we're on
  const host = window.location.hostname; // e.g. www.vinted.com, www.vinted.fr, etc.

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `https://${host}/api/v2/users/${memberId}/items?page=${page}&per_page=24&order=relevance`,
        { credentials: "include" }
      );

      if (!res.ok) break;
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) break;

      for (const item of items) {
        const images = [];

        // Extract photos
        if (item.photos && item.photos.length > 0) {
          for (const photo of item.photos) {
            // Use full_size_url or url — avoid thumbnails
            const imgUrl = photo.full_size_url || photo.url || "";
            if (imgUrl) images.push(imgUrl);
          }
        } else if (item.photo) {
          const imgUrl = item.photo.full_size_url || item.photo.url || "";
          if (imgUrl) images.push(imgUrl);
        }

        listings.push({
          title: item.title || "",
          description: item.description || "",
          price: parseFloat(item.price || item.total_item_price || "0"),
          brand: item.brand_title || (typeof item.brand === "string" ? item.brand : item.brand?.title) || null,
          size: item.size_title || (typeof item.size === "string" ? item.size : item.size?.title) || null,
          condition: item.status || null,
          status: item.is_closed || item.is_hidden ? "sold" : "active",
          images,
          url: `https://${host}/items/${item.id}`,
        });
      }

      page++;
      hasMore = items.length === 24;
      if (hasMore) await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) {
    console.error("[ReFlip] Vinted API fetch failed:", e);
  }

  return listings;
}

async function scrapeVintedItemPage() {
  try {
    const images = [];

    // Try JSON-LD structured data
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
            url: window.location.href.split("?")[0],
          };
        }
      } catch {}
    }

    // Try embedded page data (Vinted uses server-rendered JSON)
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || "";
      // Look for item data in various patterns Vinted uses
      const jsonMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script/s) ||
                        text.match(/"itemDto"\s*:\s*({.+?})\s*[,}]/s);
      if (jsonMatch) {
        try {
          const state = JSON.parse(jsonMatch[1]);
          const item = state.items?.currentItem || state;
          if (item.title || item.id) {
            if (item.photos) {
              for (const photo of item.photos) {
                const url = photo.full_size_url || photo.url;
                if (url) images.push(url);
              }
            }
            return {
              title: item.title || "",
              description: item.description || "",
              price: parseFloat(item.price || "0"),
              brand: item.brand_title || null,
              size: item.size_title || null,
              condition: item.status || null,
              status: item.is_closed ? "sold" : "active",
              images,
              url: window.location.href.split("?")[0],
            };
          }
        } catch {}
      }
    }

    // Fallback: DOM scraping
    const title = document.querySelector('[data-testid="item-title"], h1, [itemprop="name"]')?.textContent?.trim() ||
                  document.querySelector('meta[property="og:title"]')?.content || document.title;

    const priceEl = document.querySelector('[data-testid="item-price"], [itemprop="price"], .item-price');
    const price = parseFloat(priceEl?.getAttribute("content") || priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0");

    const desc = document.querySelector('[data-testid="item-description"], [itemprop="description"]')?.textContent?.trim() ||
                 document.querySelector('meta[property="og:description"]')?.content || "";

    const brandEl = document.querySelector('[itemprop="brand"] [itemprop="name"], [data-testid="item-brand"]');
    const brand = brandEl?.textContent?.trim() || null;

    // Images from og:image and page images
    document.querySelectorAll('meta[property="og:image"]').forEach((m) => {
      if (m.content && !images.includes(m.content)) images.push(m.content);
    });
    // Vinted item images are usually in a gallery
    document.querySelectorAll('[data-testid="item-photo"] img, .item-photos img, .item-gallery img').forEach((img) => {
      const src = img.src || img.getAttribute("data-src") || "";
      if (src && !images.includes(src) && !src.includes("svg")) images.push(src);
    });

    return {
      title, description: desc, price, brand, size: null, condition: null,
      status: "active", images,
      url: window.location.href.split("?")[0],
    };
  } catch {
    return null;
  }
}

function scrapeItemCards() {
  const listings = [];
  const seen = new Set();

  // Vinted item cards on closet/search pages
  const cards = document.querySelectorAll('.feed-grid__item, [data-testid*="item"], .ItemBox_container, .item-card');

  for (const card of cards) {
    const link = card.querySelector('a[href*="/items/"]') || card.closest('a[href*="/items/"]');
    if (!link) continue;
    const href = link.getAttribute("href")?.split("?")[0];
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const fullUrl = href.startsWith("http") ? href : `https://${window.location.hostname}${href}`;

    const titleEl = card.querySelector('[data-testid*="title"], .ItemBox_title, .item-title');
    const title = titleEl?.textContent?.trim() || "";

    const priceEl = card.querySelector('[data-testid*="price"], .ItemBox_price, .item-price');
    const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0";

    const img = card.querySelector('img[src*="vinted"], img[data-src*="vinted"]');
    const imgSrc = img?.src || img?.getAttribute("data-src") || "";
    const images = [];
    if (imgSrc && !imgSrc.includes("svg")) {
      // Upgrade to full size if possible
      images.push(imgSrc.replace(/\/f\d+\//, "/f800/").replace(/\?\w.*/, ""));
    }

    const brandEl = card.querySelector('[data-testid*="brand"], .ItemBox_brand');
    const brand = brandEl?.textContent?.trim() || null;

    listings.push({
      title,
      description: "",
      price: parseFloat(priceText) || 0,
      brand,
      size: null,
      condition: null,
      status: "active",
      images,
      url: fullUrl,
    });
  }

  return listings;
}

async function autoScroll() {
  let lastHeight = document.body.scrollHeight;
  for (let i = 0; i < 25; i++) {
    window.scrollBy(0, 800);
    await new Promise((r) => setTimeout(r, 500));
    if (document.body.scrollHeight === lastHeight) break;
    lastHeight = document.body.scrollHeight;
  }
  window.scrollTo(0, 0);
}
