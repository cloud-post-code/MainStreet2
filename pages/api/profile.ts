export const runtime = 'edge'

import { getSupabaseClient } from '../../lib/supabase'

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

  try {
    const supabase = getSupabaseClient()

    const [conversationsRes, inboxRes, signalsRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, turn_count, created_at', { count: 'exact' })
        .eq('session_fingerprint', customerId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('inbox_threads')
        .select('id, read_at', { count: 'exact' })
        .eq('customer_id', customerId),
      supabase
        .from('customer_preference_signals')
        .select('signal_type, product_name, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const sessionCount = conversationsRes.count ?? (conversationsRes.data?.length ?? 0)
    const totalTurns = (conversationsRes.data ?? []).reduce((sum, s) => sum + (s.turn_count ?? 0), 0)
    const inboxCount = inboxRes.count ?? (inboxRes.data?.length ?? 0)
    const unreadCount = (inboxRes.data ?? []).filter(t => !t.read_at).length
    const signals = signalsRes.data ?? []

    const signalCounts: Record<string, number> = {}
    for (const s of signals) {
      signalCounts[s.signal_type] = (signalCounts[s.signal_type] ?? 0) + 1
    }

    return new Response(
      JSON.stringify({
        sessionCount,
        totalTurns,
        inboxCount,
        unreadCount,
        recentSignals: signals.slice(0, 10),
        signalCounts,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to load profile' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
