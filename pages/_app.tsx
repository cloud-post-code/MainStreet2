import type { AppProps } from 'next/app'
import { SessionProvider } from 'next-auth/react'
import { useRouter } from 'next/router'
import '../styles/globals.css'

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  const router = useRouter()
  // Admin pages use the default NextAuth handler at /api/auth
  const isAdmin = router.pathname.startsWith('/admin') || router.pathname.startsWith('/api/admin')
  const basePath = isAdmin ? '/api/auth' : '/api/auth/shopper'

  return (
    <SessionProvider session={session} basePath={basePath}>
      <Component {...pageProps} />
    </SessionProvider>
  )
}
