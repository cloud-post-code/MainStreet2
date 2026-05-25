import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface Product {
  shop_name: string;
  product_name: string;
  price: string;
  description: string;
  category: string;
  sku: string;
  availability: string;
  image_url: string;
  source_url: string;
}

const SHOP_NAME = 'Blake Hill Preserves';
const BASE_URL = 'https://blakehillpreserves.com';

const COLLECTIONS = [
  { slug: 'naked-jams-no-added-sugar', name: 'Naked Jams (No Added Sugar)' },
  { slug: 'naked-chocolates', name: 'Naked Chocolates' },
  { slug: 'cheese-pairings', name: 'Cheese Pairings' },
  { slug: 'savory-and-spicy-pantry', name: 'Savory & Spicy Pantry' },
  { slug: 'artisan-preserves', name: 'Artisan Preserves' },
  { slug: 'fine-marmalades', name: 'Quintessential Marmalades' },
  { slug: 'gourmet-pie-fillings', name: 'Gourmet Pie Fillings' },
  { slug: 'limited-private-kitchen-batch', name: 'Limited: Private Kitchen Batch' },
  { slug: 'seasonal-offering', name: 'Preserves for the Season' },
  { slug: 'gift-sets', name: 'Gift Sets' },
];

function escapeCsv(value: string): string {
  if (value == null) return '';
  const str = String(value).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function productsToCsv(products: Product[]): string {
  const headers = [
    'Shop Name', 'Product Name', 'Price', 'Description',
    'Category', 'SKU', 'Availability', 'Image URL', 'Source URL',
  ];
  const rows = products.map(p => [
    escapeCsv(p.shop_name),
    escapeCsv(p.product_name),
    escapeCsv(p.price),
    escapeCsv(p.description),
    escapeCsv(p.category),
    escapeCsv(p.sku),
    escapeCsv(p.availability),
    escapeCsv(p.image_url),
    escapeCsv(p.source_url),
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

async function getProductUrls(page: Page, collectionSlug: string): Promise<string[]> {
  const urls = new Set<string>();
  let pageNum = 1;

  while (true) {
    const url = `${BASE_URL}/collections/${collectionSlug}?page=${pageNum}`;
    console.log(`  Fetching collection page: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);

    const links = await page.$$eval('a[href]', (anchors) =>
      anchors
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.includes('/products/'))
    );

    if (links.length === 0) break;

    const countBefore = urls.size;
    links.forEach((l) => {
      // Normalize to /products/ path (strip collection prefix)
      const match = l.match(/\/products\/([^?#]+)/);
      if (match) urls.add(`${BASE_URL}/products/${match[1]}`);
    });

    // No new products found — we've passed the last page
    if (urls.size === countBefore && pageNum > 1) break;

    // Check if a "next page" link exists
    const hasNext = await page.$('a[href*="?page="], .pagination__next, [aria-label="Next"]');
    if (!hasNext) break;

    pageNum++;
  }

  return Array.from(urls);
}

async function scrapeProduct(page: Page, productUrl: string, category: string): Promise<Product[]> {
  // Use 'load' event and then wait briefly for JS to hydrate — networkidle
  // can hang on pages with persistent websocket/analytics connections
  await page.goto(productUrl, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);

  // Product title
  const productName = await page.$eval(
    'h1.product__title, h1[class*="product-title"], h1.product-single__title, h1',
    (el) => el.textContent?.trim() ?? ''
  ).catch(() => '');

  // Bail out early if this is a 404 page
  const pageTitle = await page.title();
  if (pageTitle.toLowerCase().includes('404') || pageTitle.toLowerCase().includes('not found')) {
    console.log(`    [404 skip] ${productUrl}`);
    return [];
  }

  // Description — prefer specific product-description class over generic .rte (which can match promo banners)
  const description = await page.$eval(
    '[class*="product-description"]:not(header):not(nav), .product__description, .product-single__description',
    (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  ).catch(() => '');

  // Image URL — prefer og:image meta, fall back to first product image
  const imageUrl = await page.$eval(
    'meta[property="og:image"]',
    (el) => (el as HTMLMetaElement).content ?? ''
  ).catch(async () => {
    return await page.$eval(
      '.product__media img, .product-single__photo img, img[class*="product"]',
      (el) => (el as HTMLImageElement).src ?? ''
    ).catch(() => '');
  });

  // Availability — check for add-to-cart button state or sold-out badge
  const availability = await page.$eval(
    'button[name="add"], button[data-add-to-cart], [class*="sold-out"], [class*="unavailable"]',
    (el) => {
      const text = el.textContent?.toLowerCase() ?? '';
      if (text.includes('sold out') || text.includes('unavailable') || el.hasAttribute('disabled')) {
        return 'Out of Stock';
      }
      return 'In Stock';
    }
  ).catch(() => 'Unknown');

  // Variants — each variant becomes its own row
  // Try JSON product data first (Shopify embeds it in various script tags)
  const variantsData = await page.evaluate(() => {
    // Method 1: <script type="application/json" data-product-json>
    const jsonEl = document.querySelector('script[data-product-json], script[type="application/json"][id*="product"]');
    if (jsonEl && jsonEl.textContent) {
      try {
        const data = JSON.parse(jsonEl.textContent);
        if (data.variants) {
          return data.variants.map((v: any) => ({
            sku: v.sku || '',
            price: v.price ? (v.price / 100).toFixed(2) : '',
            title: v.title || '',
            available: v.available,
          }));
        }
      } catch {}
    }

    // Method 2: Scan all inline scripts for a product JSON blob
    const scripts = Array.from(document.querySelectorAll('script:not([src])'));
    for (const s of scripts) {
      const text = s.textContent ?? '';
      if (!text.includes('"variants"') || !text.includes('"price"')) continue;
      // Try to find a JSON object that contains a variants array
      try {
        // Look for assignment like: var product = {...} or window.__st.p = {...}
        const match = text.match(/(?:product\s*[=:]\s*|"product"\s*:\s*)(\{[\s\S]*?"variants"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/);
        if (match) {
          // Find end of JSON object by counting braces
          let depth = 0, start = text.indexOf(match[1]), end = start;
          for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          const data = JSON.parse(text.slice(start, end));
          if (data.variants && Array.isArray(data.variants)) {
            return data.variants.map((v: any) => ({
              sku: v.sku || '',
              price: v.price ? (v.price / 100).toFixed(2) : '',
              title: v.title || '',
              available: v.available,
            }));
          }
        }
      } catch {}
    }

    // Method 3: window.ShopifyAnalytics
    try {
      const sa = (window as any).ShopifyAnalytics;
      if (sa?.meta?.product?.variants) {
        return sa.meta.product.variants.map((v: any) => ({
          sku: v.sku || '',
          price: v.price ? (v.price / 100).toFixed(2) : '',
          title: v.name || '',
          available: true,
        }));
      }
    } catch {}

    return null;
  });

  const products: Product[] = [];

  if (variantsData && variantsData.length > 0) {
    for (const variant of variantsData) {
      const variantName = variant.title && variant.title !== 'Default Title'
        ? `${productName} - ${variant.title}`
        : productName;
      products.push({
        shop_name: SHOP_NAME,
        product_name: variantName,
        price: variant.price ? `$${variant.price}` : '',
        description,
        category,
        sku: variant.sku,
        availability: variant.available === false ? 'Out of Stock' : 'In Stock',
        image_url: imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl,
        source_url: productUrl,
      });
    }
  } else {
    // Fallback: single row with page-level price
    const price = await page.$eval(
      '.price__regular .price-item--regular, .product__price .price, [class*="product-price"], .price',
      (el) => el.textContent?.trim() ?? ''
    ).catch(() => '');

    products.push({
      shop_name: SHOP_NAME,
      product_name: productName,
      price,
      description,
      category,
      sku: '',
      availability,
      image_url: imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl,
      source_url: productUrl,
    });
  }

  return products;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const allProducts: Product[] = [];
  const seenUrls = new Set<string>();

  try {
    for (const collection of COLLECTIONS) {
      console.log(`\nCollection: ${collection.name}`);
      const productUrls = await getProductUrls(page, collection.slug);
      console.log(`  Found ${productUrls.length} product URLs`);

      for (const url of productUrls) {
        if (seenUrls.has(url)) {
          console.log(`  [skip duplicate] ${url}`);
          continue;
        }
        seenUrls.add(url);
        console.log(`  Scraping: ${url}`);
        try {
          const rows = await scrapeProduct(page, url, collection.name);
          allProducts.push(...rows);
          console.log(`    → ${rows.length} variant(s)`);
        } catch (err) {
          console.error(`    ERROR scraping ${url}:`, (err as Error).message);
        }
        // Polite delay
        await page.waitForTimeout(500);
      }
    }
  } finally {
    await browser.close();
  }

  const outDir = path.join(__dirname, '..', 'scripts');
  const csvPath = path.join(outDir, 'blake-hill-products.csv');
  fs.writeFileSync(csvPath, productsToCsv(allProducts), 'utf8');

  console.log(`\nDone! ${allProducts.length} rows written to ${csvPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
