export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'
import type { ConversationRow } from '../../../lib/types'

const TTL_MS = 24 * 60 * 60 * 1000

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { sessionId } = await req.json() as { sessionId?: string }
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const identity = await resolveCustomerId(req)
  const supabase = getSupabaseClient()

  // Fetch the source conversation, verifying ownership
  const baseQuery = supabase.from('conversations').select('*').eq('id', sessionId)
  const ownershipQuery = identity.isAuthenticated
    ? baseQuery.eq('user_id', identity.id)
    : baseQuery.eq('session_fingerprint', identity.id)

  const { data: old, error: fetchError } = await ownershipQuery.single()

  if (fetchError || !old) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const source = old as ConversationRow
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()

  const newRow: Record<string, unknown> = {
    messages: source.messages,
    turn_count: source.turn_count,
    version: 0,
    session_fingerprint: identity.isAuthenticated ? null : identity.id,
    user_id: identity.isAuthenticated ? identity.id : null,
    expires_at: expiresAt,
    last_search_results: source.last_search_results,
    last_derived_query: source.last_derived_query,
  }

  const { data: newSession, error: insertError } = await supabase
    .from('conversations')
    .insert(newRow)
    .select()
    .single()

  if (insertError || !newSession) {
    return new Response(JSON.stringify({ error: 'Could not create session' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ sessionId: newSession.id }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
