import NextAuth, { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

// Simple in-memory rate limiter: track failed attempts per IP
const failedAttempts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = failedAttempts.get(ip)
  if (!record || now > record.resetAt) return true
  return record.count < RATE_LIMIT
}

function recordFailure(ip: string): void {
  const now = Date.now()
  const record = failedAttempts.get(ip)
  if (!record || now > record.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
  } else {
    record.count++
  }
}

function clearFailures(ip: string): void {
  failedAttempts.delete(ip)
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const ip =
          (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          'unknown'

        if (!checkRateLimit(ip)) {
          throw new Error('Too many failed attempts. Try again in 15 minutes.')
        }

        if (!credentials?.email || !credentials?.password) return null

        const db = getAdminClient()
        const { data: user, error } = await db
          .from('admin_users')
          .select('id, email, password_hash, name')
          .eq('email', credentials.email.toLowerCase())
          .single()

        if (error || !user) {
          recordFailure(ip)
          return null
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) {
          recordFailure(ip)
          return null
        }

        clearFailures(ip)
        return { id: user.id, email: user.email, name: user.name ?? undefined }
      },
    }),
  ],
  pages: {
    signIn: '/admin/login',
    error: '/admin/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string
      }
      return session
    },
  },
}

export default NextAuth(authOptions)
