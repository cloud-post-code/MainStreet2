export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'
import type { InboxThread } from '../../../lib/types'

export default async function handler(req: Request): Promise<Response> {
  const identity = await resolveCustomerId(req)
  const supabase = getSupabaseClient()

  if (req.method === 'GET') {
    const query = supabase
      .from('inbox_threads')
      .select('*')
      .order('last_activity_at', { ascending: false })
      .limit(50)

    const { data, error } = await (identity.isAuthenticated
      ? query.eq('user_id', identity.id)
      : query.eq('customer_id', identity.id))

    if (error) {
      return new Response(JSON.stringify({ error: 'Failed to load inbox' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    const unreadCount = (data as InboxThread[]).filter(t => !t.read_at).length

    return new Response(JSON.stringify({ threads: data, unreadCount }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json' },
  })
}
