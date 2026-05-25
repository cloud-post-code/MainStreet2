import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'

export default function AdminLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError(result.error === 'CredentialsSignin' ? 'Invalid email or password.' : result.error)
    } else {
      router.push('/admin/companies')
    }
  }

  return (
    <>
      <Head><title>Admin Login — Main Street</title></Head>
      <div style={styles.page}>
        <Link href="/" style={styles.backLink}>← Back to Main Street</Link>
        <div style={styles.card}>
          <div style={styles.logo}>Main Street Admin</div>
          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={styles.input}
              placeholder="admin@mainstreet.local"
            />
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={styles.input}
            />
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    background: '#f7f7f5',
    fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
  },
  backLink: {
    color: '#6b7280',
    fontSize: 14,
    textDecoration: 'none',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '40px 48px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    width: 400,
    maxWidth: '100%',
  },
  logo: {
    fontFamily: 'Georgia, serif',
    fontSize: 22,
    fontWeight: 700,
    color: '#015237',
    letterSpacing: '0.04em',
    marginBottom: 28,
    textAlign: 'center',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  input: {
    padding: '10px 14px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 8,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 4,
  },
  button: {
    marginTop: 8,
    padding: '11px 0',
    background: '#015237',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
}
