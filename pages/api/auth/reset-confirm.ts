import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const { token, password } = await req.json() as { token?: string; password?: string }

  if (!token || !password) {
    return new Response(JSON.stringify({ error: 'Token and password are required' }), { status: 400 })
  }

  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const db = getDb()

  const { data: resetToken } = await db
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .single()

  if (!resetToken || resetToken.used_at || new Date(resetToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'This reset link is invalid or has expired' }), { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const { error } = await db
    .from('users')
    .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .eq('id', resetToken.user_id)

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to update password — try again' }), { status: 500 })
  }

  await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', resetToken.id)

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
