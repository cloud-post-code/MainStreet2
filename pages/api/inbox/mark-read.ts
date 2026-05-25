export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { threadId } = await req.json() as { threadId?: string }
  if (!threadId) {
    return new Response(JSON.stringify({ error: 'threadId is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const identity = await resolveCustomerId(req)
  const supabase = getSupabaseClient()

  const updateQuery = supabase
    .from('inbox_threads')
    .update({ read_at: new Date().toISOString() })
    .eq('id', threadId)
    .is('read_at', null)

  await (identity.isAuthenticated
    ? updateQuery.eq('user_id', identity.id)
    : updateQuery.eq('customer_id', identity.id))

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
