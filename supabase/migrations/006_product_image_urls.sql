-- Add image_urls array to products for multi-image support
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

-- Backfill existing single image_url into the array
UPDATE products SET image_urls = ARRAY[image_url] WHERE image_url IS NOT NULL AND image_url <> '';
