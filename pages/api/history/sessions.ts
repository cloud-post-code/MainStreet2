export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'

async function getCustomerId(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  const customerId = await getCustomerId(req)
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, messages, last_search_results, last_derived_query, turn_count, version, session_fingerprint, expires_at, created_at')
    .eq('session_fingerprint', customerId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load sessions' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ sessions: data ?? [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
