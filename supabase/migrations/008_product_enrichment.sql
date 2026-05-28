-- Raw stock label (free-form, e.g. "Low stock (3 left)"). Structured stock
-- already lives in products.availability (in_stock|out_of_stock|limited|unknown).
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_status TEXT;

-- Vision-derived "mapped listing" produced by gpt-4o-mini from each product's
-- image + scraped text. 1:1 with products so it can be re-run cheaply.
CREATE TABLE IF NOT EXISTS product_enrichment (
  product_id         UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  category           TEXT,
  subcategory        TEXT,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  attributes         JSONB  NOT NULL DEFAULT '{}'::jsonb,
  vision_description TEXT,
  search_keywords    TEXT[] NOT NULL DEFAULT '{}',
  use_cases          TEXT[] NOT NULL DEFAULT '{}',
  target_customer    TEXT,
  gift_fit           TEXT,
  brand_vibe         TEXT,
  model              TEXT NOT NULL,
  enriched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_image_url   TEXT
);

CREATE INDEX IF NOT EXISTS product_enrichment_tags_idx ON product_enrichment USING GIN (tags);
CREATE INDEX IF NOT EXISTS product_enrichment_keywords_idx ON product_enrichment USING GIN (search_keywords);
CREATE INDEX IF NOT EXISTS product_enrichment_category_idx ON product_enrichment (category);
