-- Multiple images per product
CREATE TABLE IF NOT EXISTS product_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url     TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_images_product_id_idx ON product_images (product_id, display_order);

-- Migrate existing single images into product_images
INSERT INTO product_images (product_id, image_url, display_order)
SELECT id, image_url, 0
FROM products
WHERE image_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- Update match_products to also return image_urls array
CREATE OR REPLACE FUNCTION match_products(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
RETURNS TABLE (
  id            UUID,
  business_id   UUID,
  business_name TEXT,
  name          TEXT,
  description   TEXT,
  price         NUMERIC,
  url           TEXT,
  image_url     TEXT,
  image_urls    TEXT[],
  last_seen     TIMESTAMPTZ,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    p.business_id,
    p.business_name,
    p.name,
    p.description,
    p.price,
    p.url,
    p.image_url,
    COALESCE(
      ARRAY(
        SELECT pi.image_url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.display_order, pi.created_at
      ),
      ARRAY[]::TEXT[]
    ) AS image_urls,
    p.last_seen,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;
