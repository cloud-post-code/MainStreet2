import { useState, FormEvent } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const { status } = useSession({ required: false } as Parameters<typeof useSession>[0])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Already logged in — redirect to home
  if (status === 'authenticated') {
    router.replace('/')
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: '/',
    }, undefined)

    setLoading(false)
    if (result?.error) {
      if (result.error.includes('Too many')) {
        setError('Too many failed attempts. Try again in 15 minutes.')
      } else {
        setError("That password doesn't match — try again")
      }
    } else {
      router.push(result?.url ?? '/')
    }
  }

  return (
    <>
      <Head><title>Sign in — Main Street</title></Head>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.mason}>🧱</div>
          <h1 style={styles.heading}>Welcome back</h1>
          <p style={styles.sub}>Sign in to see your saved conversations and orders</p>
          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              inputMode="email"
              autoComplete="email"
              style={styles.input}
              placeholder="you@example.com"
            />
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={styles.input}
            />
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div style={styles.links}>
            <Link href="/reset-password" style={styles.link}>Forgot password?</Link>
            <span style={styles.sep}>·</span>
            <Link href="/signup" style={styles.link}>Create account</Link>
          </div>
        </div>
      </div>
    </>
  )
}

// Override the NextAuth base path so this page uses the shopper provider
LoginPage.auth = false

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#faf6f1',
    fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 48px',
    boxShadow: '0 2px 20px rgba(0,0,0,0.07)',
    width: 420,
    maxWidth: '90vw',
    textAlign: 'center' as const,
  },
  mason: {
    fontSize: 56,
    marginBottom: 12,
  },
  heading: {
    fontFamily: 'Georgia, serif',
    fontSize: 28,
    fontWeight: 700,
    color: '#1a1a1a',
    margin: '0 0 8px',
  },
  sub: {
    color: '#666',
    fontSize: 15,
    margin: '0 0 28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    textAlign: 'left' as const,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#444',
    marginBottom: 2,
  },
  input: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1.5px solid #ddd',
    fontSize: 15,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 14,
  },
  button: {
    marginTop: 4,
    padding: '13px',
    background: '#2d6a4f',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
  },
  links: {
    marginTop: 20,
    fontSize: 14,
    color: '#666',
  },
  link: {
    color: '#2d6a4f',
    textDecoration: 'none',
  },
  sep: {
    margin: '0 8px',
    color: '#bbb',
  },
}
