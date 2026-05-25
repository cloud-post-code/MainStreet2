-- pgvector similarity search RPC used by lib/search.ts
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
    p.last_seen,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;
