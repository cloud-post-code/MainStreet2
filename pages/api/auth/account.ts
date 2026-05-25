import { createClient } from '@supabase/supabase-js'
import { resolveCustomerId } from '../../../lib/auth'

export const runtime = 'edge'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const identity = await resolveCustomerId(req)
  if (!identity.isAuthenticated) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 })
  }

  const db = getDb()
  const { error } = await db.from('users').delete().eq('id', identity.id)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to delete account' }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
