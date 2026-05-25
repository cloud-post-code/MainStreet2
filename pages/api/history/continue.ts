export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import type { ConversationRow } from '../../../lib/types'

const TTL_MS = 24 * 60 * 60 * 1000

async function getCustomerId(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

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

  const customerId = await getCustomerId(req)
  const supabase = getSupabaseClient()

  const { data: old, error: fetchError } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', sessionId)
    .eq('session_fingerprint', customerId)
    .single()

  if (fetchError || !old) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const source = old as ConversationRow
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()

  const { data: newSession, error: insertError } = await supabase
    .from('conversations')
    .insert({
      messages: source.messages,
      turn_count: source.turn_count,
      version: 0,
      session_fingerprint: customerId,
      expires_at: expiresAt,
      last_search_results: source.last_search_results,
      last_derived_query: source.last_derived_query,
    })
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
