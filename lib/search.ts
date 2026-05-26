import { getSupabaseClient } from './supabase'
import type { ProductResult, BusinessResult } from './types'

export async function searchProductsMulti(queries: string[], limitPerQuery = 5): Promise<ProductResult[]> {
  if (queries.length === 0) return []

  const embResp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: queries, model: 'text-embedding-3-small' }),
  })
  if (!embResp.ok) throw new Error(`Embeddings API error: ${embResp.status}`)

  const embData = await embResp.json() as { data: Array<{ embedding: number[] }> }
  const embeddings = embData.data.map(d => d.embedding)

  if (embeddings.length !== queries.length) {
    throw new Error(`Embedding count mismatch: expected ${queries.length}, got ${embeddings.length}`)
  }

  const supabase = getSupabaseClient()
  const rpcResults = await Promise.all(
    embeddings.map(embedding =>
      supabase.rpc('match_products', { query_embedding: embedding, match_threshold: 0.72, match_count: limitPerQuery })
    )
  )

  const seen = new Map<string, ProductResult>()
  for (const { data } of rpcResults) {
    for (const p of (data ?? []) as ProductResult[]) {
      if (!seen.has(p.id) || seen.get(p.id)!.similarity < p.similarity) seen.set(p.id, p)
    }
  }
  return [...seen.values()].sort((a, b) => b.similarity - a.similarity)
}

export async function searchBusinesses(query: string, town?: string, limit = 5): Promise<BusinessResult[]> {
  // Escape LIKE wildcards to prevent pattern manipulation via LLM-supplied strings
  const safeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')

  const supabase = getSupabaseClient()
  let q = supabase
    .from('businesses')
    .select('id, name, url, town, status, categories(name)')
    .eq('status', 'active')
    .ilike('name', `%${safeLike(query)}%`)
    .limit(limit)
  if (town) q = (q as typeof q).ilike('town', `%${safeLike(town)}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((b: Record<string, unknown>) => ({
    id: b.id as string,
    name: b.name as string,
    url: b.url as string,
    town: b.town as string,
    status: b.status as string,
    // categories is a one-to-many join — Supabase returns an array
    category: (b.categories as Array<{ name: string }> | null)?.[0]?.name ?? null,
  }))
}
