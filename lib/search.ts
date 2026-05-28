import { getSupabaseClient } from './supabase'
import type { ProductResult } from './types'

export interface SearchFilters {
  limit?: number
  min_price?: number
  max_price?: number
  business_id?: string
}

export async function searchProducts(query: string, filters: SearchFilters = {}): Promise<ProductResult[]> {
  const limit = filters.limit ?? 5
  const hasFilters = filters.min_price != null || filters.max_price != null || filters.business_id != null

  // Pull a wider net when post-filtering so we don't starve the agent.
  const matchCount = hasFilters ? Math.max(limit * 4, 20) : limit

  const embeddingResp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: query, model: 'text-embedding-3-small' }),
  })
  const embeddingData = await embeddingResp.json() as { data: Array<{ embedding: number[] }> }
  const embedding = embeddingData.data[0].embedding

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('match_products', {
    query_embedding: embedding,
    // 0.30 is intentionally lenient — text-embedding-3-small puts semantically related items in the 0.4–0.7 range;
    // a strict threshold filters out plenty of relevant products. Mason curates the top results.
    match_threshold: 0.30,
    match_count: matchCount,
  })
  if (error) throw error

  let rows = (data ?? []) as ProductResult[]

  if (filters.min_price != null) rows = rows.filter(r => r.price >= filters.min_price!)
  if (filters.max_price != null) rows = rows.filter(r => r.price <= filters.max_price!)
  if (filters.business_id) rows = rows.filter(r => r.business_id === filters.business_id)

  return rows.slice(0, limit)
}

export async function getProductsByIds(ids: string[]): Promise<ProductResult[]> {
  if (ids.length === 0) return []
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, business_id, business_name, name, price, url, image_url, last_seen')
    .in('id', ids)
  if (error) throw error

  const { data: imageRows } = await supabase
    .from('product_images')
    .select('product_id, image_url, display_order')
    .in('product_id', ids)
    .order('display_order', { ascending: true })

  const imagesByProduct = new Map<string, string[]>()
  for (const row of (imageRows ?? []) as Array<{ product_id: string; image_url: string }>) {
    const arr = imagesByProduct.get(row.product_id) ?? []
    arr.push(row.image_url)
    imagesByProduct.set(row.product_id, arr)
  }

  const byId = new Map<string, ProductResult>()
  for (const r of (data ?? []) as Array<Omit<ProductResult, 'image_urls' | 'similarity'>>) {
    byId.set(r.id, {
      ...r,
      image_urls: imagesByProduct.get(r.id) ?? (r.image_url ? [r.image_url] : []),
      similarity: 1,
    })
  }
  // Preserve caller order
  return ids.map(id => byId.get(id)).filter((x): x is ProductResult => x != null)
}
