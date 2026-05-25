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

  const customerId = await getCustomerId(req)
  const supabase = getSupabaseClient()

  await supabase
    .from('inbox_threads')
    .update({ read_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('customer_id', customerId)
    .is('read_at', null)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
