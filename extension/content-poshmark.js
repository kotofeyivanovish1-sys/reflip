// ReFlip Sync — Poshmark Content Script
// Runs on poshmark.com pages, scrapes listing data when asked by popup

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scrape_page" || msg.action === "scrape_all") {
    scrapePoshmarkListings().then(sendResponse).catch((e) =>
      sendResponse({ error: e.message, listings: [], platform: "poshmark" })
    );
    return true; // async response
  }
});

async function scrapePoshmarkListings() {
  const url = window.location.href;
  const listings = [];

  // ── Single listing page ──
  if (url.includes("/listing/")) {
    const item = scrapePoshmarkListingPage();
    if (item) listings.push(item);
    return { listings, platform: "poshmark" };
  }

  // ── Closet page (poshmark.com/closet/username) ──
  if (url.includes("/closet/")) {
    await autoScroll();
    const cards = document.querySelectorAll('[data-et-name="listing"], .card--small, .tile');
    const seen = new Set();

    // Try __NEXT_DATA__ first for structured data
    const nextDataEl = document.querySelector("#__NEXT_DATA__");
    if (nextDataEl) {
      try {
        const nd = JSON.parse(nextDataEl.textContent);
        const posts = nd?.props?.pageProps?.closetData?.posts ||
                      nd?.props?.pageProps?.posts ||
                      nd?.props?.pageProps?.data?.posts || [];
        for (const post of posts) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);
          listings.push(parsePoshmarkPost(post));
        }
        if (listings.length > 0) return { listings, platform: "poshmark" };
      } catch {}
    }

    // Fallback: scrape DOM
    for (const card of cards) {
      const link = card.querySelector('a[href*="/listing/"]') || card.closest('a[href*="/listing/"]');
      if (!link) continue;
      const href = link.getAttribute("href");
      if (seen.has(href)) continue;
      seen.add(href);

      const item = scrapePoshmarkCard(card, href);
      if (item) listings.push(item);
    }

    // Also try generic product links
    if (listings.length === 0) {
      document.querySelectorAll('a[href*="/listing/"]').forEach((a) => {
        const href = a.getAttribute("href");
        if (!href || seen.has(href)) return;
        seen.add(href);
        const item = scrapePoshmarkCard(a, href);
        if (item) listings.push(item);
      });
    }

    return { listings, platform: "poshmark" };
  }

  // ── My Seller page / other pages ──
  const allLinks = document.querySelectorAll('a[href*="/listing/"]');
  const seen = new Set();
  for (const a of allLinks) {
    const href = a.getAttribute("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const item = scrapePoshmarkCard(a, href);
    if (item) listings.push(item);
  }

  return { listings, platform: "poshmark" };
}

function scrapePoshmarkListingPage() {
  try {
    // Try __NEXT_DATA__
    const nextDataEl = document.querySelector("#__NEXT_DATA__");
    if (nextDataEl) {
      try {
        const nd = JSON.parse(nextDataEl.textContent);
        const props = nd?.props?.pageProps;
        const listing = props?.listing || props?.data?.listing || props?.post || props?.data?.post;
        if (listing) return parsePoshmarkPost(listing);
      } catch {}
    }

    // Fallback: scrape DOM
    const title = document.querySelector('meta[property="og:title"]')?.content ||
                  document.querySelector('[data-test="listing-title"], .listing__title, h1')?.textContent?.trim() ||
                  document.title;

    const priceEl = document.querySelector('[data-test="listing-price"], .listing__price, [class*="listingPrice"]');
    const price = priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0";

    const descEl = document.querySelector('[data-test="listing-description"], .listing__description');
    const description = descEl?.textContent?.trim() || "";

    const images = [];
    document.querySelectorAll('meta[property="og:image"]').forEach((m) => {
      if (m.content && !images.includes(m.content)) images.push(m.content);
    });
    document.querySelectorAll('img[src*="cloudfront.net"], img[src*="dtpmhvbsmwahlz"]').forEach((img) => {
      const src = img.src;
      if (src && !images.includes(src)) images.push(src);
    });

    const brandEl = document.querySelector('[data-test="listing-brand"], .listing__brand');
    const sizeEl = document.querySelector('[data-test="listing-size"], .listing__size');

    return {
      title,
      description,
      price: parseFloat(price) || 0,
      brand: brandEl?.textContent?.trim() || null,
      size: sizeEl?.textContent?.trim() || null,
      condition: null,
      status: document.querySelector('[class*="sold"], .sold-tag') ? "sold" : "active",
      images,
      url: window.location.href,
    };
  } catch {
    return null;
  }
}

function parsePoshmarkPost(post) {
  const images = [];

  // Extract images from post object
  const pics = post.pictures || post.photos || post.cover_shot_pictures || [];
  for (const pic of pics) {
    const url = pic.url_original || pic.url_full || pic.url_large || pic.url || pic;
    if (typeof url === "string" && url.startsWith("http")) images.push(url);
  }
  if (post.cover_shot?.url_original || post.cover_shot?.url_full) {
    const coverUrl = post.cover_shot.url_original || post.cover_shot.url_full;
    if (!images.includes(coverUrl)) images.unshift(coverUrl);
  }

  const isSold = post.inventory?.status === "sold_out" ||
                 post.status === "sold" ||
                 post.inventory?.size_quantity_revision?.[0]?.size_quantity_value === 0;

  return {
    title: post.title || post.display_title || "",
    description: post.description || "",
    price: parseFloat(post.price_amount?.val || post.original_price_amount?.val || post.price || "0"),
    brand: post.brand?.name || post.brand_name || (typeof post.brand === "string" ? post.brand : null),
    size: post.size?.display || post.size_display || (typeof post.size === "string" ? post.size : null),
    condition: post.condition || null,
    status: isSold ? "sold" : "active",
    images,
    url: post.id ? `https://poshmark.com/listing/${post.id}` : "",
  };
}

function scrapePoshmarkCard(card, href) {
  try {
    const fullUrl = href.startsWith("http") ? href : `https://poshmark.com${href}`;
    const img = card.querySelector("img");
    const imgSrc = img?.src || "";
    const images = imgSrc ? [imgSrc] : [];

    const title = img?.alt ||
                  card.querySelector('[class*="title"], .tile__title')?.textContent?.trim() ||
                  card.getAttribute("title") || "";

    const priceEl = card.querySelector('[class*="price"], .tile__price');
    const price = priceEl?.textContent?.replace(/[^0-9.]/g, "") || "0";

    const brandEl = card.querySelector('[class*="brand"]');
    const sizeEl = card.querySelector('[class*="size"]');

    const isSold = card.querySelector('[class*="sold"]') !== null ||
                   card.textContent?.toLowerCase().includes("sold");

    return {
      title,
      description: "",
      price: parseFloat(price) || 0,
      brand: brandEl?.textContent?.trim() || null,
      size: sizeEl?.textContent?.trim() || null,
      condition: null,
      status: isSold ? "sold" : "active",
      images,
      url: fullUrl,
    };
  } catch {
    return null;
  }
}

async function autoScroll() {
  const distance = 800;
  const maxScrolls = 50;
  let scrolls = 0;
  let lastHeight = document.body.scrollHeight;

  while (scrolls < maxScrolls) {
    window.scrollBy(0, distance);
    await new Promise((r) => setTimeout(r, 600));
    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      // Try clicking "load more" button if exists
      const loadMore = document.querySelector('[class*="load-more"], [class*="loadMore"], button[class*="more"]');
      if (loadMore) {
        loadMore.click();
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        break;
      }
    }
    lastHeight = newHeight;
    scrolls++;
  }
  window.scrollTo(0, 0);
}
