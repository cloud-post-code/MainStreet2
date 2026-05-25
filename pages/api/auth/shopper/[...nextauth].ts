import NextAuth, { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

async function checkDbRateLimit(key: string): Promise<boolean> {
  const db = getDb()
  const { data } = await db.from('auth_rate_limits').select('attempts, reset_at').eq('key', key).single()
  if (!data || new Date(data.reset_at) < new Date()) return true
  return data.attempts < 5
}

async function recordDbAttempt(key: string): Promise<void> {
  const db = getDb()
  const resetAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const { data: existing } = await db.from('auth_rate_limits').select('attempts, reset_at').eq('key', key).single()
  if (!existing || new Date(existing.reset_at) < new Date()) {
    await db.from('auth_rate_limits').upsert({ key, attempts: 1, reset_at: resetAt })
  } else {
    await db.from('auth_rate_limits').update({ attempts: existing.attempts + 1 }).eq('key', key)
  }
}

async function clearDbAttempts(key: string): Promise<void> {
  const db = getDb()
  await db.from('auth_rate_limits').delete().eq('key', key)
}

export const shopperAuthOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const ip =
          (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? 'unknown'
        const email = credentials?.email?.toLowerCase() ?? ''
        const rateLimitKey = `shopper:${email}:${ip}`

        if (!(await checkDbRateLimit(rateLimitKey))) {
          throw new Error('Too many failed attempts. Try again in 15 minutes.')
        }

        if (!credentials?.email || !credentials?.password) return null

        const db = getDb()
        const { data: user, error } = await db
          .from('users')
          .select('id, email, password_hash, name')
          .eq('email', email)
          .single()

        if (error || !user) {
          await recordDbAttempt(rateLimitKey)
          return null
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) {
          await recordDbAttempt(rateLimitKey)
          return null
        }

        await clearDbAttempts(rateLimitKey)
        return { id: user.id, email: user.email, name: user.name ?? undefined, role: 'shopper' as const }
      },
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role ?? 'shopper'
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id = token.id as string
        ;(session.user as { id?: string; role?: string }).role = token.role as string
      }
      return session
    },
  },
}

export default NextAuth(shopperAuthOptions)
