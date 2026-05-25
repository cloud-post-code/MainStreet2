-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Businesses: the 50 curated local shops
CREATE TABLE businesses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  url                   TEXT NOT NULL,
  town                  TEXT NOT NULL,
  selectors             JSONB NOT NULL DEFAULT '{}',
  last_scraped          TIMESTAMPTZ,
  product_count_baseline INT DEFAULT 0
);

-- Products: scraped catalog, re-embedded nightly
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,
  description   TEXT,
  price         DECIMAL(10,2) NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  image_url     TEXT,
  embedding     vector(1536),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON products (business_id);
CREATE INDEX ON products (last_seen);

-- Orders: manual fulfillment tracking
CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL UNIQUE,
  customer_email    TEXT NOT NULL,
  items             JSONB NOT NULL,
  context           JSONB,
  status            TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','purchased','shipped','delivered')),
  fulfillment_sla   DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
