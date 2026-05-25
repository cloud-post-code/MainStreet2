export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  const identity = await resolveCustomerId(req)
  const supabase = getSupabaseClient()

  const query = supabase
    .from('conversations')
    .select('id, messages, last_search_results, last_derived_query, turn_count, version, session_fingerprint, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const { data, error } = await (identity.isAuthenticated
    ? query.eq('user_id', identity.id)
    : query.eq('session_fingerprint', identity.id))

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load sessions' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ sessions: data ?? [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
