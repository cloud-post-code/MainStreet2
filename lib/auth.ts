// Edge-safe identity resolution. No bcryptjs import — safe for Edge runtime.
import { jwtVerify } from 'jose'
import { getSupabaseClient } from './supabase'

const SHOPPER_COOKIE = 'next-auth.session-token'
const SHOPPER_COOKIE_SECURE = '__Secure-next-auth.session-token'

export interface ResolvedIdentity {
  id: string
  isAuthenticated: boolean
}

function extractCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

async function buildFingerprint(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function resolveCustomerId(req: Request): Promise<ResolvedIdentity> {
  const secret = process.env.NEXTAUTH_SECRET
  if (secret) {
    const cookieHeader = req.headers.get('cookie') ?? ''
    const token =
      extractCookieValue(cookieHeader, SHOPPER_COOKIE_SECURE) ??
      extractCookieValue(cookieHeader, SHOPPER_COOKIE)

    if (token) {
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
        const sub = payload.sub ?? (payload as Record<string, unknown>).id as string | undefined
        const role = (payload as Record<string, unknown>).role as string | undefined
        // Only accept shopper tokens — never accept admin tokens for shopper identity
        if (sub && role === 'shopper') {
          return { id: sub, isAuthenticated: true }
        }
      } catch {
        // Invalid/expired token — fall through to fingerprint
      }
    }
  }

  return { id: await buildFingerprint(req), isAuthenticated: false }
}

// Persistent rate limit check using Supabase (survives serverless cold starts)
export async function checkRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): Promise<boolean> {
  const supabase = getSupabaseClient()
  const now = new Date()
  const { data } = await supabase
    .from('auth_rate_limits')
    .select('attempts, reset_at')
    .eq('key', key)
    .single()

  if (!data || new Date(data.reset_at) < now) return true
  return data.attempts < maxAttempts
}

export async function recordRateLimitAttempt(key: string, windowMs = 15 * 60 * 1000): Promise<void> {
  const supabase = getSupabaseClient()
  const resetAt = new Date(Date.now() + windowMs).toISOString()
  await supabase.from('auth_rate_limits').upsert(
    { key, attempts: 1, reset_at: resetAt },
    { onConflict: 'key', ignoreDuplicates: false }
  )
  // Increment if row already existed and is not expired
  await supabase.rpc('increment_rate_limit', { p_key: key, p_reset_at: resetAt }).maybeSingle()
}

export async function clearRateLimit(key: string): Promise<void> {
  const supabase = getSupabaseClient()
  await supabase.from('auth_rate_limits').delete().eq('key', key)
}
