-- Scraper admin dashboard additions
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS scrape_notes TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_scraped TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS scrape_status TEXT NOT NULL DEFAULT 'never'
  CHECK (scrape_status IN ('never', 'running', 'success', 'error', 'cancelled'));
-- Shape: { added: number, priceChanges: [{name, oldPrice, newPrice}], removed: number }
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_scrape_diff JSONB;

CREATE INDEX IF NOT EXISTS businesses_scrape_status_idx ON businesses (scrape_status);
CREATE INDEX IF NOT EXISTS businesses_last_scraped_idx ON businesses (last_scraped);
