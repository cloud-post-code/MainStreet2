import { getSupabaseClient } from './supabase'
import type { ProductResult, MessageParam } from './types'

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
