# Database Schema

Main Street uses Supabase (Postgres) with the pgvector extension. Migrations live in `supabase/migrations/` and must be run in order.

---

## businesses

Curated local shops. ~50 records. Created by admin import or the admin portal.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `name` | `text` | Shop display name |
| `url` | `text` | Shop homepage |
| `town` | `text` | Town name (used for "3 towns" trust note) |
| `selectors` | `jsonb` | Reserved for per-shop CSS selector overrides (default `{}`) |
| `last_scraped` | `timestamptz` | Set by scraper on completion |
| `product_count_baseline` | `int` | Used by anomaly guard |
| `category_id` | `uuid` | FK → `categories.id` (nullable) |
| `status` | `text` | `active` \| `deactivated` (default `active`) |
| `verification_status` | `text` | `pending_review` \| `verified` \| `rejected` \| `needs_info` |
| `contact_name` | `text` | Admin-only contact info |
| `contact_email` | `text` | |
| `contact_phone` | `text` | |
| `address_street` | `text` | |
| `address_city` | `text` | |
| `address_state` | `text` | |
| `address_zip` | `text` | |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

---

## products

Scraped product catalog with vector embeddings.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `business_id` | `uuid` | FK → `businesses.id` ON DELETE CASCADE |
| `business_name` | `text` | Denormalized for query performance |
| `name` | `text` | Product title, sanitized |
| `description` | `text` | Nullable |
| `price` | `decimal(10,2)` | |
| `url` | `text` | UNIQUE — used as upsert conflict key by scraper |
| `image_url` | `text` | Nullable |
| `embedding` | `vector(1536)` | From `text-embedding-3-small` |
| `last_seen` | `timestamptz` | Updated by scraper on each run |
| `category_id` | `uuid` | FK → `categories.id` (nullable) |
| `sku` | `text` | Nullable |
| `status` | `text` | `active` \| `deactivated` |
| `availability` | `text` | `in_stock` \| `out_of_stock` \| `limited` \| `unknown` |
| `image_status` | `text` | Admin tracking field |
| `updated_at` | `timestamptz` | |

**Indexes:**
- `ivfflat (embedding vector_cosine_ops) WITH (lists = 100)` — vector ANN search
- `(business_id)`, `(last_seen)`, `(status)`, `(availability)`, `(updated_at)`

---

## product_field_overrides

Tracks which product fields have been manually edited in the admin portal. The scraper skips overridden fields on re-import.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `product_id` | `uuid` | FK → `products.id` ON DELETE CASCADE |
| `field_name` | `text` | e.g. `"name"`, `"price"`, `"image_url"` |

Unique on `(product_id, field_name)`.

---

## conversations

Multi-turn chat sessions. One row per user session. Expires after 24 hours (TTL on `expires_at`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `messages` | `jsonb` | Array of `MessageParam` — full conversation history |
| `last_search_results` | `jsonb` | Last product results shown (nullable) |
| `last_derived_query` | `text` | Last search query Mason extracted (nullable) |
| `turn_count` | `smallint` | 0–8. Chat is locked at 8. |
| `version` | `integer` | Optimistic concurrency counter |
| `session_fingerprint` | `text` | SHA-256 of `user-agent \| ip` (nullable if enforcement off) |
| `expires_at` | `timestamptz` | Extended on each turn. Indexed. |
| `created_at` | `timestamptz` | |

**TTL cleanup:** Run manually or via pg_cron:
```sql
DELETE FROM conversations WHERE expires_at < NOW() - INTERVAL '1 hour';
```

---

## orders

Stripe checkout state. Created before Stripe session; updated by webhook on completion.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `stripe_session_id` | `text` | UNIQUE |
| `customer_email` | `text` | From Stripe |
| `items` | `jsonb` | Line items snapshot |
| `context` | `jsonb` | Full conversation context at checkout time |
| `status` | `text` | `received` \| `purchased` \| `shipped` \| `delivered` |
| `fulfillment_sla` | `date` | Manual date for delivery tracking |
| `conversation_id` | `uuid` | FK → `conversations.id` (nullable) |
| `total_cents` | `integer` | Pre-computed for reporting |
| `created_at` | `timestamptz` | |

---

## categories

Taxonomy for businesses and products. Seeded with 10 defaults.

| Column | Type |
|--------|------|
| `id` | `uuid` PK |
| `name` | `text` UNIQUE |
| `slug` | `text` UNIQUE |

Default categories: Home & Garden, Clothing & Accessories, Food & Beverage, Health & Beauty, Arts & Crafts, Sports & Outdoors, Books & Media, Gifts & Specialty, Electronics, Other.

---

## admin_users

Admin portal accounts.

| Column | Type |
|--------|------|
| `id` | `uuid` PK |
| `email` | `text` UNIQUE |
| `password_hash` | `text` | bcrypt |
| `name` | `text` nullable |
| `created_at` | `timestamptz` |
| `updated_at` | `timestamptz` |

---

## inbox_threads

Outbound messages from admin to customer (recommendations, order updates, new arrivals).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `customer_id` | `text` | Session fingerprint used as customer identifier |
| `subject` | `text` | |
| `thread_type` | `text` | `recommendation` \| `order_update` \| `new_arrival` \| `availability` |
| `messages` | `jsonb` | Thread messages |
| `opening_product` | `jsonb` | ProductResult snapshot (nullable) |
| `read_at` | `timestamptz` | Null until customer opens |
| `last_activity_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

---

## match_products RPC

Vector similarity search. Used by `lib/search.ts:searchProducts()`.

```sql
SELECT * FROM match_products(
  query_embedding => vector,   -- 1536-dim float array
  match_threshold  => float,   -- similarity cutoff (0.75 default)
  match_count      => int      -- max results (5 default)
);
```

Returns: `id, business_id, business_name, name, description, price, url, image_url, last_seen, similarity`.

Uses cosine distance: `similarity = 1 - (embedding <=> query_embedding)`. Higher is more similar.

---

## Related

- [Architecture](explanation-architecture.md) — why pgvector, why optimistic concurrency
- [How to Add a Business](howto-add-business.md) — inserting businesses and scraping products
