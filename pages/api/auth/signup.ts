import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function checkRateLimit(key: string): Promise<boolean> {
  const db = getDb()
  const { data } = await db.from('auth_rate_limits').select('attempts, reset_at').eq('key', key).single()
  if (!data || new Date(data.reset_at) < new Date()) return true
  return data.attempts < 5
}

async function recordAttempt(key: string): Promise<void> {
  const db = getDb()
  const resetAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { data: existing } = await db.from('auth_rate_limits').select('attempts, reset_at').eq('key', key).single()
  if (!existing || new Date(existing.reset_at) < new Date()) {
    await db.from('auth_rate_limits').upsert({ key, attempts: 1, reset_at: resetAt })
  } else {
    await db.from('auth_rate_limits').update({ attempts: existing.attempts + 1 }).eq('key', key)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password, name } = req.body as { email?: string; password?: string; name?: string }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  const ip = ((req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? 'unknown').trim()
  const rateLimitKey = `signup:${ip}`

  if (!(await checkRateLimit(rateLimitKey))) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
  }

  const db = getDb()
  const { data: existing } = await db.from('users').select('id').eq('email', normalizedEmail).single()
  if (existing) {
    await recordAttempt(rateLimitKey)
    return res.status(409).json({ error: 'An account with that email already exists', code: 'EMAIL_EXISTS' })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const { data: user, error } = await db
    .from('users')
    .insert({ email: normalizedEmail, password_hash: passwordHash, name: name?.trim() || null })
    .select('id, email, name')
    .single()

  if (error || !user) {
    return res.status(500).json({ error: "Couldn't create your account — try again" })
  }

  return res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } })
}
