import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { useState } from 'react'

export default function AccountPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (status === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.skeleton} />
        <div style={{ ...styles.skeleton, width: 200, marginTop: 12 }} />
        <div style={{ ...styles.skeleton, width: 280, marginTop: 12 }} />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  const user = session?.user as { id?: string; email?: string; name?: string; role?: string } | undefined

  async function handleDeleteAccount() {
    setDeleting(true)
    const res = await fetch('/api/auth/account', { method: 'DELETE' })
    if (res.ok) {
      await signOut({ callbackUrl: '/' })
    } else {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <>
      <Head><title>Your account — Main Street</title></Head>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.mason}>🧱😊</div>
          <h1 style={styles.heading}>
            {user?.name ? `Hey, ${user.name}` : 'Your account'}
          </h1>
          <p style={styles.email}>{user?.email}</p>

          <div style={styles.sections}>
            <Link href="/history" style={styles.sectionLink}>
              <div style={styles.section}>
                <span style={styles.sectionIcon}>💬</span>
                <div>
                  <div style={styles.sectionTitle}>Chat history</div>
                  <div style={styles.sectionSub}>Your saved conversations with Mason</div>
                </div>
                <span style={styles.sectionArrow}>→</span>
              </div>
            </Link>

            <Link href="/inbox" style={styles.sectionLink}>
              <div style={styles.section}>
                <span style={styles.sectionIcon}>📬</span>
                <div>
                  <div style={styles.sectionTitle}>Inbox</div>
                  <div style={styles.sectionSub}>Messages and recommendations from Mason</div>
                </div>
                <span style={styles.sectionArrow}>→</span>
              </div>
            </Link>
          </div>

          <div style={styles.actions}>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              style={styles.signOutBtn}
            >
              Sign out
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={styles.deleteBtn}
            >
              Delete account
            </button>
          </div>
        </div>

        {showDeleteConfirm && (
          <div style={styles.overlay}>
            <div style={styles.modal}>
              <div style={styles.mason}>🧱</div>
              <h2 style={styles.modalHeading}>Delete your account?</h2>
              <p style={styles.modalSub}>
                This will permanently delete your account, all conversations, orders, and inbox messages. This cannot be undone.
              </p>
              <div style={styles.modalActions}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={styles.cancelBtn}
                  disabled={deleting}
                >
                  Keep my account
                </button>
                <button
                  onClick={handleDeleteAccount}
                  style={styles.confirmDeleteBtn}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete my account and all data'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#faf6f1',
    fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  skeleton: {
    height: 20,
    width: 320,
    background: '#e8e4df',
    borderRadius: 8,
    animation: 'pulse 1.5s infinite',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '40px 48px',
    boxShadow: '0 2px 20px rgba(0,0,0,0.07)',
    width: 480,
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
    margin: '0 0 6px',
  },
  email: {
    color: '#888',
    fontSize: 14,
    margin: '0 0 28px',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    marginBottom: 28,
    textAlign: 'left' as const,
  },
  sectionLink: {
    textDecoration: 'none',
    color: 'inherit',
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    borderRadius: 10,
    border: '1.5px solid #eee',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  sectionIcon: {
    fontSize: 24,
    flexShrink: 0,
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 15,
    color: '#1a1a1a',
  },
  sectionSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  sectionArrow: {
    marginLeft: 'auto',
    color: '#bbb',
    fontSize: 18,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    marginTop: 4,
  },
  signOutBtn: {
    padding: '11px',
    background: '#f5f5f5',
    color: '#333',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
  },
  deleteBtn: {
    padding: '11px',
    background: 'transparent',
    color: '#dc2626',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    minHeight: 44,
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    padding: '36px 40px',
    maxWidth: 420,
    width: '100%',
    textAlign: 'center' as const,
  },
  modalHeading: {
    fontFamily: 'Georgia, serif',
    fontSize: 22,
    fontWeight: 700,
    color: '#1a1a1a',
    margin: '0 0 12px',
  },
  modalSub: {
    color: '#666',
    fontSize: 14,
    lineHeight: 1.5,
    margin: '0 0 24px',
  },
  modalActions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  cancelBtn: {
    padding: '12px',
    background: '#f5f5f5',
    color: '#333',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
  },
  confirmDeleteBtn: {
    padding: '12px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 44,
  },
}
