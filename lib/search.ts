import { getSupabaseClient } from './supabase'
import type { ProductResult, BusinessResult, MessageParam } from './types'

// Derive a clean, unambiguous search query from the full conversation history.
// Uses GPT-4o-mini — cheap, fast, no need for a heavier model for this extraction task.
export async function deriveSearchQuery(messages: MessageParam[]): Promise<string> {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'Customer' : 'Mason'}: ${typeof m.content === 'string' ? m.content : ''}`)
    .join('\n')

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 50,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Extract a single product search query (under 20 words) from this shopping conversation. Return ONLY the query string, nothing else.',
        },
        { role: 'user', content: transcript },
      ],
    }),
  })
  const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

export async function searchProductsMulti(queries: string[], limitPerQuery = 5): Promise<ProductResult[]> {
  const embResp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: queries, model: 'text-embedding-3-small' }),
  })
  const embData = await embResp.json() as { data: Array<{ embedding: number[] }> }
  const embeddings = embData.data.map(d => d.embedding)

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
  const supabase = getSupabaseClient()
  let q = supabase
    .from('businesses')
    .select('id, name, url, town, status, categories(name)')
    .eq('status', 'active')
    .ilike('name', `%${query}%`)
    .limit(limit)
  if (town) q = (q as typeof q).ilike('town', `%${town}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((b: Record<string, unknown>) => ({
    id: b.id as string,
    name: b.name as string,
    url: b.url as string,
    town: b.town as string,
    status: b.status as string,
    category: (b.categories as { name: string } | null)?.name ?? null,
  }))
}

export async function searchProducts(query: string, limit = 5): Promise<ProductResult[]> {
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
    match_threshold: 0.75,
    match_count: limit,
  })
  if (error) throw error
  return (data ?? []) as ProductResult[]
}
