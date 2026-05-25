export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import type { InboxThread } from '../../../lib/types'

async function getCustomerId(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function handler(req: Request): Promise<Response> {
  const customerId = await getCustomerId(req)
  const supabase = getSupabaseClient()

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('inbox_threads')
      .select('*')
      .eq('customer_id', customerId)
      .order('last_activity_at', { ascending: false })
      .limit(50)

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
