import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const prefillEmail = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('email') ?? ''
    : ''

  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    const data = await res.json()

    if (!res.ok) {
      setLoading(false)
      if (data.code === 'EMAIL_EXISTS') {
        setError('An account with that email already exists.')
      } else if (data.error?.includes('8 characters')) {
        setError('Password must be at least 8 characters')
      } else if (res.status === 429) {
        setError('Too many attempts. Try again in 15 minutes.')
      } else {
        setError("Couldn't create your account — try again")
      }
      return
    }

    // Auto sign in after successful signup
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl: '/',
    })

    setLoading(false)
    if (result?.error) {
      router.push('/login')
    } else {
      router.push('/')
    }
  }

  return (
    <>
      <Head><title>Create account — Main Street</title></Head>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.mason}>🧱🤔</div>
          <h1 style={styles.heading}>Create your account</h1>
          <p style={styles.sub}>Your conversations and orders will be saved across all your devices</p>
          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              autoComplete="name"
              style={styles.input}
              placeholder="What should Mason call you?"
            />
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
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
              autoComplete="new-password"
              style={styles.input}
              placeholder="At least 8 characters"
            />
            {error && (
              <div style={styles.error}>
                {error}
                {error.includes('already exists') && (
                  <> <Link href="/login" style={styles.errorLink}>Sign in →</Link></>
                )}
              </div>
            )}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <div style={styles.links}>
            Already have an account?{' '}
            <Link href="/login" style={styles.link}>Sign in</Link>
          </div>
          <div style={styles.homeLink}>
            <Link href="/" style={styles.link}>← Back to home</Link>
          </div>
        </div>
      </div>
    </>
  )
}

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
  errorLink: {
    color: '#dc2626',
    fontWeight: 600,
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
    fontWeight: 600,
  },
  homeLink: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
}
