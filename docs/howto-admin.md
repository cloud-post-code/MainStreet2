# How to Manage the Admin Portal

The admin portal at `/admin` lets you manage businesses, products, orders, and the product catalog without touching the database directly.

## Prerequisites

- An admin account. Create one with:
  ```bash
  SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/seed-admin.ts
  ```
- Access to `/admin/login`

## Managing businesses

### View all businesses

Navigate to `/admin` → **Businesses**. Businesses are listed with their verification status and product count.

### Edit a business

Click a business name → **Edit**. Editable fields:
- Name, URL, town, category
- Contact info (name, email, phone, address)
- Status (`active` / `deactivated`) — deactivated businesses' products won't appear in search
- Verification status (`pending_review` / `verified` / `rejected` / `needs_info`)

Click **Save** to update.

### Deactivate a business

On the business edit page, set **Status** to `deactivated`. This is a soft delete — the business and its products remain in the database but are excluded from Mason's search results.

### Import businesses in bulk

Navigate to **Businesses → Import**. Upload a JSON array:

```json
[
  {
    "name": "The Kitchen Collective",
    "url": "https://kitchencollective.com",
    "town": "Northampton",
    "category": "home-garden"
  }
]
```

Businesses are inserted without products. Run the scraper after importing to populate products.

## Managing products

### View products

Navigate to **Products**. Filter by:
- Business name
- Status (`active` / `deactivated`)
- Availability

### Edit a product

Click a product → **Edit**. When you save a field, that field is **locked** — the scraper will not overwrite it on future runs. Locked fields show a lock icon.

Editable fields:
- Name, description, price, image URL
- Category, SKU
- Status, availability

### Manually create a product

Navigate to **Products → New**. Fill in all required fields. You'll need to run `npm run scrape` to generate the embedding — manually created products won't have embeddings until scraped.

> **Note:** Manually created products without embeddings won't appear in Mason's semantic search results until their embeddings are generated. Either run the scraper for their business, or use the API to generate an embedding manually.

### Import products in bulk

Navigate to **Products → Import**. Upload a JSON array of products with at minimum: `business_id`, `name`, `price`, `url`.

## Managing orders

Orders are created when a customer completes Stripe checkout. The admin portal shows order status (`received` → `purchased` → `shipped` → `delivered`).

Update status manually as you fulfill orders. The `fulfillment_sla` date field is for your own tracking.

## Inbox (messaging customers)

The Inbox lets you send messages to customers — recommendations, order updates, new arrivals. Customers see these at `/inbox`.

From a product page in the admin portal, you can send a "You might like this" recommendation to a customer session. Threads are scoped to the customer's session fingerprint.

## Verification

After making changes, confirm they're live:
1. Visit `http://localhost:3000`
2. Ask Mason for something the edited product or business would surface
3. Verify it appears (or doesn't, if you deactivated it)

## Troubleshooting

**Can't log in to admin**

Rate limiting: 5 failed attempts locks the IP for 15 minutes. The lockout is in-memory and resets on server restart.

**Changes don't appear in search**

Product search is live — no cache. If a product isn't appearing, check:
1. The product's `status` is `active`
2. The business's `status` is `active`
3. The product has an `embedding` (null embeddings are excluded from vector search)

## Related

- [How to Add a Business](howto-add-business.md) — scraping a new shop's catalog
- [Database Schema](reference-schema.md) — `product_field_overrides`, `admin_users`
