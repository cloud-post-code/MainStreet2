import { getSupabaseClient } from './supabase'
import type { ProductResult } from './types'

export interface SearchFilters {
  limit?: number
  min_price?: number
  max_price?: number
  business_id?: string
}

export async function generateProductEmbedding(text: string): Promise<number[]> {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
  })
  const data = await resp.json() as { data: Array<{ embedding: number[] }> }
  return data.data[0].embedding
}

export async function searchProducts(query: string, filters: SearchFilters = {}): Promise<ProductResult[]> {
  const limit = filters.limit ?? 5
  const hasFilters = filters.min_price != null || filters.max_price != null || filters.business_id != null

  // Pull a wider net when post-filtering so we don't starve the agent.
  const matchCount = hasFilters ? Math.max(limit * 4, 20) : limit

  const embedding = await generateProductEmbedding(query)

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

  // Products without embeddings (e.g. admin-created) are invisible to the RPC.
  // Fall back to keyword search so Mason can still find them.
  if (rows.length === 0) {
    rows = await fallbackTextSearch(query, matchCount, supabase)
  }

  if (filters.min_price != null) rows = rows.filter(r => r.price >= filters.min_price!)
  if (filters.max_price != null) rows = rows.filter(r => r.price <= filters.max_price!)
  if (filters.business_id) rows = rows.filter(r => r.business_id === filters.business_id)

  return rows.slice(0, limit)
}

async function fallbackTextSearch(
  query: string,
  limit: number,
  supabase: ReturnType<typeof getSupabaseClient>,
): Promise<ProductResult[]> {
  const words = query.split(/\s+/).filter(w => w.length > 2).slice(0, 6)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any
  let q = client
    .from('products')
    .select('id, business_id, business_name, name, price, url, image_url, last_seen')
    .limit(limit)

  if (words.length > 0) {
    const conditions = words.flatMap((w: string) => [
      `name.ilike.%${w}%`,
      `description.ilike.%${w}%`,
    ])
    q = q.or(conditions.join(','))
  }

  const { data } = (await q) as { data: Array<Omit<ProductResult, 'image_urls' | 'similarity'>> | null }
  if (!data || data.length === 0) return []

  const ids = data.map(r => r.id)
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

  return data.map(r => ({
    ...r,
    similarity: 0.5,
    image_urls: imagesByProduct.get(r.id) ?? (r.image_url ? [r.image_url] : []),
  }))
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
