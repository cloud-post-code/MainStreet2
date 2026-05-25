import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { createHash, randomBytes } from 'crypto'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const { email } = await req.json() as { email?: string }
  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const db = getDb()

  // Always return success to prevent email enumeration
  const { data: user } = await db.from('users').select('id').eq('email', normalizedEmail).single()
  if (!user) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

  // Invalidate existing tokens for this user
  await db.from('password_reset_tokens').delete().eq('user_id', user.id)

  await db.from('password_reset_tokens').insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })

  const origin = req.headers.get('origin') ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const resetUrl = `${origin}/reset-password?token=${token}`

  try {
    const mailer = getMailer()
    await mailer.sendMail({
      from: process.env.SMTP_FROM ?? 'Mason <noreply@mainstreet.local>',
      to: normalizedEmail,
      subject: 'Reset your Main Street password',
      text: `Click this link to reset your password (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
      html: `<p>Click <a href="${resetUrl}">here</a> to reset your Main Street password. This link expires in 1 hour.</p><p>If you didn't request this, ignore this email.</p>`,
    })
  } catch (err) {
    console.error('reset email failed', err)
    // Don't expose mail errors to the client
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
