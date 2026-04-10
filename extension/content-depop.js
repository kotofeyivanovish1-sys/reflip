// ReFlip Sync — Depop Content Script
// Scrapes listing data from the user's authenticated Depop session

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scrape_page" || msg.action === "scrape_all") {
    scrapeDepopListings(msg.action === "scrape_all").then(sendResponse).catch((e) =>
      sendResponse({ error: e.message, listings: [], platform: "depop" })
    );
    return true;
  }
});

async function scrapeDepopListings(fetchAll) {
  const url = window.location.href;

  // ── Single product page ──
  if (url.includes("/products/")) {
    const item = scrapeDepopProductPage();
    return { listings: item ? [item] : [], platform: "depop" };
  }

  // ── Shop/closet page — use Depop API (browser has auth cookies) ──
  const usernameMatch = url.match(/depop\.com\/@([^/?#]+)/);
  if (usernameMatch) {
    const username = usernameMatch[1];
    const listings = await fetchUserListingsViaApi(username);
    if (listings.length > 0) return { listings, platform: "depop" };
  }

  // Fallback: scroll and scrape cards, then fetch each product page
  await autoScroll();
  const links = [...document.querySelectorAll('a[href*="/products/"]')];
  const seen = new Set();
  const productUrls = [];

  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    productUrls.push(href.startsWith("http") ? href : `https://www.depop.com${href}`);
  }

  // Fetch each product page for real data
  const listings = [];
  for (const pUrl of productUrls) {
    const item = await fetchProductData(pUrl);
    if (item) listings.push(item);
  }

  return { listings, platform: "depop" };
}

// Use Depop's own API from the browser (user is authenticated)
async function fetchUserListingsViaApi(username) {
  const listings = [];
  try {
    // First get user ID
    const userRes = await fetch(`https://webapi.depop.com/api/v1/users/${username}/`, {
      credentials: "include",
    });
    if (!userRes.ok) throw new Error("Could not fetch user");
    const userData = await userRes.json();
    const userId = userData.id;

    // Fetch all products
    let offset = 0;
    const limit = 24;
    let hasMore = true;

    while (hasMore) {
      const prodRes = await fetch(
        `https://webapi.depop.com/api/v2/users/${userId}/products/?offset=${offset}&limit=${limit}`,
        { credentials: "include" }
      );
      if (!prodRes.ok) break;
      const prodData = await prodRes.json();
      const products = prodData.products || prodData.objects || [];
      if (products.length === 0) break;

      for (const p of products) {
        // Get high-res images
        const images = [];
        if (p.pictures || p.images) {
          for (const pic of (p.pictures || p.images)) {
            if (Array.isArray(pic)) {
              // Array of sizes — pick largest
              const best = pic[pic.length - 1];
              images.push(typeof best === "string" ? best : best.url);
            } else if (pic.formats) {
              // Pick largest format
              const best = pic.formats[pic.formats.length - 1];
              images.push(best?.url || pic.url);
            } else if (pic.url) {
              images.push(pic.url);
            } else if (typeof pic === "string") {
              images.push(pic);
            }
          }
        }
        // Upgrade image URLs to full resolution
        const hiResImages = images.map(upgradeDepopImageUrl);

        const slug = p.slug || p.id || "";
        listings.push({
          title: p.description?.split("\n")[0]?.slice(0, 120) || slug,
          description: p.description || "",
          price: parseFloat(p.price?.priceAmount || p.preview_price_data?.priceAmount || p.price_amount || "0"),
          brand: p.brand?.name || (typeof p.brand === "string" ? p.brand : null),
          size: p.size?.name || (typeof p.size === "string" ? p.size : null),
          condition: p.condition || null,
          status: p.status === 0 || p.sold ? "sold" : "active",
          images: hiResImages,
          url: `https://www.depop.com/products/${slug}/`,
        });
      }

      offset += limit;
      hasMore = products.length === limit;
      if (!hasMore) break;
      await new Promise((r) => setTimeout(r, 300)); // Rate limit
    }
  } catch (e) {
    console.error("[ReFlip] API fetch failed:", e);
  }
  return listings;
}

// Upgrade Depop CDN URLs to full resolution
function upgradeDepopImageUrl(url) {
  if (!url || typeof url !== "string") return url;
  // Depop images: replace /c/ crop params with full size
  return url
    .replace(/\/c\/[^/]+\//, "/") // remove crop
    .replace(/w_\d+/, "w_1280")   // max width
    .replace(/h_\d+/, "h_1280");  // max height
}

// Fetch single product page data
async function fetchProductData(productUrl) {
  try {
    const slug = productUrl.match(/products\/([^/?#]+)/)?.[1];
    if (!slug) return null;

    const res = await fetch(`https://webapi.depop.com/api/v2/products/${slug}/`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const p = await res.json();

    const images = [];
    if (p.pictures) {
      for (const pic of p.pictures) {
        if (Array.isArray(pic)) {
          const best = pic[pic.length - 1];
          images.push(typeof best === "string" ? best : best.url);
        } else if (pic.url) {
          images.push(pic.url);
        }
      }
    }

    return {
      title: p.description?.split("\n")[0]?.slice(0, 120) || slug,
      description: p.description || "",
      price: parseFloat(p.price?.priceAmount || "0"),
      brand: p.brand?.name || null,
      size: p.size?.name || null,
      condition: p.condition || null,
      status: p.sold ? "sold" : "active",
      images: images.map(upgradeDepopImageUrl),
      url: productUrl,
    };
  } catch {
    return null;
  }
}

function scrapeDepopProductPage() {
  // Try __NEXT_DATA__
  const nextDataEl = document.querySelector("#__NEXT_DATA__");
  if (nextDataEl) {
    try {
      const nd = JSON.parse(nextDataEl.textContent);
      const p = nd?.props?.pageProps?.product;
      if (p) {
        const images = [];
        if (p.pictures) {
          for (const pic of p.pictures) {
            if (Array.isArray(pic)) images.push(pic[pic.length - 1]?.url || pic[0]?.url);
            else if (pic.url) images.push(pic.url);
          }
        }
        return {
          title: p.description?.split("\n")[0]?.slice(0, 120) || p.slug || "",
          description: p.description || "",
          price: parseFloat(p.price?.priceAmount || "0"),
          brand: p.brand?.name || null,
          size: p.size?.name || null,
          condition: p.condition || null,
          status: p.sold ? "sold" : "active",
          images: images.map(upgradeDepopImageUrl),
          url: window.location.href,
        };
      }
    } catch {}
  }

  // Fallback: meta tags
  const images = [];
  document.querySelectorAll('meta[property="og:image"]').forEach((m) => {
    if (m.content) images.push(m.content);
  });

  return {
    title: document.querySelector('meta[property="og:title"]')?.content || document.title,
    description: document.querySelector('meta[property="og:description"]')?.content || "",
    price: parseFloat(document.querySelector('meta[property="og:price:amount"]')?.content || "0"),
    brand: null, size: null, condition: null,
    status: "active",
    images,
    url: window.location.href,
  };
}

async function autoScroll() {
  let lastHeight = document.body.scrollHeight;
  for (let i = 0; i < 30; i++) {
    window.scrollBy(0, 800);
    await new Promise((r) => setTimeout(r, 500));
    if (document.body.scrollHeight === lastHeight) break;
    lastHeight = document.body.scrollHeight;
  }
  window.scrollTo(0, 0);
}
