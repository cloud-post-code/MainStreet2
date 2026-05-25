import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const router = useRouter()
  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'sent' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRequestReset(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setLoading(false)
    setStatus('sent')
  }

  async function handleConfirmReset(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    const res = await fetch('/api/auth/reset-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      setStatus('success')
      setTimeout(() => router.push('/login'), 2000)
    } else {
      setErrorMsg(data.error ?? 'Something went wrong — try again')
      setStatus('error')
    }
  }

  return (
    <>
      <Head><title>Reset password — Main Street</title></Head>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.mason}>🧱</div>

          {!token && status === 'idle' && (
            <>
              <h1 style={styles.heading}>Reset your password</h1>
              <p style={styles.sub}>Enter your email and we'll send you a reset link</p>
              <form onSubmit={handleRequestReset} style={styles.form}>
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
                <button type="submit" disabled={loading} style={styles.button}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              <div style={styles.links}>
                <Link href="/login" style={styles.link}>Back to sign in</Link>
              </div>
            </>
          )}

          {status === 'sent' && (
            <>
              <h1 style={styles.heading}>Check your email</h1>
              <p style={styles.sub}>If an account exists for {email}, you'll receive a reset link shortly. Check your spam folder if it doesn't arrive.</p>
              <Link href="/login" style={styles.link}>Back to sign in</Link>
            </>
          )}

          {token && status !== 'success' && (
            <>
              <h1 style={styles.heading}>Set a new password</h1>
              <form onSubmit={handleConfirmReset} style={styles.form}>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                  style={styles.input}
                  placeholder="New password (at least 8 characters)"
                />
                {errorMsg && <div style={styles.error}>{errorMsg}</div>}
                <button type="submit" disabled={loading} style={styles.button}>
                  {loading ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          {status === 'success' && (
            <>
              <h1 style={styles.heading}>Password updated!</h1>
              <p style={styles.sub}>Taking you to sign in…</p>
            </>
          )}
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
    padding: 20,
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
    fontSize: 26,
    fontWeight: 700,
    color: '#1a1a1a',
    margin: '0 0 8px',
  },
  sub: {
    color: '#666',
    fontSize: 15,
    margin: '0 0 24px',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
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
    textAlign: 'left' as const,
  },
  button: {
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
  },
  link: {
    color: '#2d6a4f',
    textDecoration: 'none',
    fontWeight: 500,
  },
}
