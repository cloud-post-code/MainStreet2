# How to Add a Business and Scrape Its Catalog

Add a new local shop to Main Street's database and populate it with products so Mason can recommend them.

## Prerequisites

- Admin portal access at `/admin`
- Shop's product listing page URLs (e.g., `https://shopname.com/collections/all`)
- Playwright installed: `npm install` (it's a dev dependency)
- `OPENAI_API_KEY` set in your environment (needed for embeddings during scrape)

## Steps

### 1. Create the business record

Log in to the admin portal at `/admin`. Navigate to **Businesses → New**.

Fill in:
- **Name** — the shop's display name (shown on product cards)
- **URL** — the shop's homepage
- **Town** — the town name (appears in the trust note)
- **Category** — choose the closest match
- **Verification status** — set to `verified` once you've confirmed the shop is real

Click **Save**. Copy the business UUID from the URL: `/admin/companies/[uuid]`.

### 2. Find product listing page URLs

Most shops on Shopify or similar platforms expose product listings at predictable URLs:

```
https://shopname.com/collections/all
https://shopname.com/shop
https://shopname.com/products
```

Open the page in a browser and confirm products are visible. You'll pass these URLs to the scraper.

### 3. Run the scraper

```bash
npm run scrape -- \
  --business-id "paste-uuid-here" \
  --name "The Kitchen Collective" \
  --urls "https://shopname.com/collections/all,https://shopname.com/collections/sale"
```

Expected output:

```
Scraping 2 URLs for "The Kitchen Collective"...
Done. Upserted: 47, Errors: 3
```

- **Upserted** — products added or updated in the database (including embeddings)
- **Errors** — pages that failed (bad URL, JS-heavy site, rate limit)

### 4. Verify the products appear in search

Visit `http://localhost:3000` and describe something the shop would sell. Mason should present products from the new shop within 1-2 turns.

You can also test the search endpoint directly:

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"cast iron skillet"}'
```

### 5. Review and fix products in the admin portal

Go to **Products** in the admin portal and filter by the new business. Check for:
- Missing or broken images
- Incorrect prices (common when the scraper misreads sale/crossed-out prices)
- Duplicate products (same item at different URLs)

Edit any incorrect fields. Editing a field in the admin portal creates a `product_field_override` record, which locks that field from being overwritten by future scraper runs.

## Verification

Mason can find products from the new shop:

```
User: "A good cast iron pan"
Mason: "The Kitchen Collective has a Lodge 10-inch Cast Iron Skillet for $34.99..."
```

## Troubleshooting

**Scraper returns 0 upserted, many errors**

The shop's product listing pages may use heavy JavaScript rendering. Try:
1. Opening the page in a browser and inspecting the HTML — do products exist in the DOM?
2. Looking for a different listing URL (some shops use `/catalog` or `/all-products`)
3. If the shop is heavily JS-dependent, manual product entry via the admin portal may be needed

**Product count drops warning**

```
Product count dropped from 47 to 12 for business abc-123
```

This means the scraper found fewer products than before. The shop may have restructured their listing page, changed their HTML, or gone offline. Inspect the URL manually and re-run.

**Images show as broken in the UI**

Check `image_url` in the admin portal. Common causes: relative URLs that the scraper didn't resolve, `data-src` lazy-load attributes, or CDN URLs that require a referrer header.

## Related

- [Database Schema](reference-schema.md) — the `businesses` and `products` tables
- [How to Manage the Admin Portal](howto-admin.md) — editing products and businesses
