import { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { signOut } from 'next-auth/react'
import Head from 'next/head'

interface Props {
  children: ReactNode
  title?: string
}

const NAV = [
  { href: '/admin/companies', label: 'Companies', active: true },
  { href: '/admin/products', label: 'Products', active: true },
  { href: '/admin/scraper', label: 'Scraper', active: true },
  { href: '#', label: 'Orders', active: false },
]

export default function AdminLayout({ children, title }: Props) {
  const router = useRouter()

  return (
    <>
      <Head>
        <title>{title ? `${title} — Main Street Admin` : 'Main Street Admin'}</title>
      </Head>
      <div style={styles.root}>
        <nav style={styles.sidebar}>
          <div style={styles.sidebarLogo}>Main Street</div>
          <div style={styles.sidebarSub}>Admin</div>
          <ul style={styles.navList}>
            {NAV.map(item => {
              const active = item.active && router.pathname.startsWith(item.href)
              return (
                <li key={item.label}>
                  {item.active ? (
                    <Link
                      href={item.href}
                      style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span style={styles.navItemDisabled}>
                      {item.label}
                      <span style={styles.comingSoon}>soon</span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <button onClick={() => signOut({ callbackUrl: '/admin/login' })} style={styles.signOut}>
            Sign out
          </button>
        </nav>
        <main style={styles.main}>{children}</main>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', minHeight: '100vh', fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif" },
  sidebar: {
    width: 220,
    background: '#015237',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    padding: '28px 0',
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    height: '100vh',
  },
  sidebarLogo: {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    padding: '0 24px',
  },
  sidebarSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '2px 24px 24px', letterSpacing: '0.08em', textTransform: 'uppercase' },
  navList: { listStyle: 'none', padding: 0, margin: 0, flex: 1 },
  navItem: {
    display: 'block',
    padding: '10px 24px',
    color: 'rgba(255,255,255,0.8)',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 0,
  },
  navItemActive: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
    fontWeight: 600,
  },
  navItemDisabled: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 24px',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    cursor: 'default',
  },
  comingSoon: {
    fontSize: 10,
    background: 'rgba(255,255,255,0.15)',
    borderRadius: 4,
    padding: '2px 6px',
    letterSpacing: '0.04em',
  },
  signOut: {
    margin: '16px 24px 0',
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 8,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
  },
  main: { flex: 1, background: '#f9fafb', padding: '36px 40px', minWidth: 0 },
}
