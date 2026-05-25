-- Admin portal additions
-- Categories taxonomy
CREATE TABLE IF NOT EXISTS categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

-- Seed default categories
INSERT INTO categories (name, slug) VALUES
  ('Home & Garden', 'home-garden'),
  ('Clothing & Accessories', 'clothing-accessories'),
  ('Food & Beverage', 'food-beverage'),
  ('Health & Beauty', 'health-beauty'),
  ('Arts & Crafts', 'arts-crafts'),
  ('Sports & Outdoors', 'sports-outdoors'),
  ('Books & Media', 'books-media'),
  ('Gifts & Specialty', 'gifts-specialty'),
  ('Electronics', 'electronics'),
  ('Other', 'other')
ON CONFLICT DO NOTHING;

-- Admin users
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users (email);

-- Extend businesses with admin fields
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS category_id        UUID REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'active'
                                              CHECK (status IN ('active', 'deactivated')),
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending_review'
                                              CHECK (verification_status IN ('pending_review', 'verified', 'rejected', 'needs_info')),
  ADD COLUMN IF NOT EXISTS contact_name       TEXT,
  ADD COLUMN IF NOT EXISTS contact_email      TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone      TEXT,
  ADD COLUMN IF NOT EXISTS address_street     TEXT,
  ADD COLUMN IF NOT EXISTS address_city       TEXT,
  ADD COLUMN IF NOT EXISTS address_state      TEXT,
  ADD COLUMN IF NOT EXISTS address_zip        TEXT,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS businesses_status_idx ON businesses (status);
CREATE INDEX IF NOT EXISTS businesses_verification_status_idx ON businesses (verification_status);
CREATE INDEX IF NOT EXISTS businesses_category_id_idx ON businesses (category_id);
CREATE INDEX IF NOT EXISTS businesses_updated_at_idx ON businesses (updated_at);

-- Extend products with admin fields
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id  UUID REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS sku          TEXT,
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'deactivated')),
  ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'unknown'
                                        CHECK (availability IN ('in_stock', 'out_of_stock', 'limited', 'unknown')),
  ADD COLUMN IF NOT EXISTS image_status TEXT NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS products_status_idx ON products (status);
CREATE INDEX IF NOT EXISTS products_availability_idx ON products (availability);
CREATE INDEX IF NOT EXISTS products_updated_at_idx ON products (updated_at);

-- Product field overrides (lock icons for manual edits)
CREATE TABLE IF NOT EXISTS product_field_overrides (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  UNIQUE (product_id, field_name)
);
CREATE INDEX IF NOT EXISTS product_field_overrides_field_name_idx ON product_field_overrides (field_name);
