import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const SHOPPER_COOKIE = 'next-auth.session-token'
const SHOPPER_COOKIE_SECURE = '__Secure-next-auth.session-token'

function extractCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/account')) {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) return NextResponse.redirect(new URL('/login', req.url))

    const cookieHeader = req.headers.get('cookie') ?? ''
    const token =
      extractCookieValue(cookieHeader, SHOPPER_COOKIE_SECURE) ??
      extractCookieValue(cookieHeader, SHOPPER_COOKIE)

    if (!token) return NextResponse.redirect(new URL('/login', req.url))

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
      const role = (payload as Record<string, unknown>).role as string | undefined
      if (role !== 'shopper') throw new Error('not shopper')
    } catch {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/account/:path*'],
}
