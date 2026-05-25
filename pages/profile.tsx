import { useState, useEffect } from 'react'
import Head from 'next/head'

interface ProfileData {
  sessionCount: number
  totalTurns: number
  inboxCount: number
  unreadCount: number
  recentSignals: Array<{ signal_type: string; product_name: string | null; created_at: string }>
  signalCounts: Record<string, number>
}

const SIGNAL_LABELS: Record<string, string> = {
  viewed: 'Viewed',
  added_to_cart: 'Added to cart',
  purchased: 'Purchased',
  dismissed: 'Dismissed',
}

const SIGNAL_ICONS: Record<string, string> = {
  viewed: '👀',
  added_to_cart: '🛒',
  purchased: '✅',
  dismissed: '✗',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  return (
    <>
      <Head><title>My Profile — Main Street</title></Head>
      <div className="page">
        <header className="header">
          <button className="logo" onClick={() => window.location.href = '/'}>Main Street</button>
          <div className="tagline">Your local personal shopper</div>
        </header>
        <nav className="tab-bar">
          <a href="/history" className="tab">Chat History</a>
          <a href="/inbox" className="tab">Inbox</a>
          <a href="/profile" className="tab tab-active">Profile</a>
        </nav>

        <div className="profile-wrap">
          {loading ? (
            <div className="skeleton-list">
              <div className="skeleton-row tall" />
              <div className="skeleton-row" />
              <div className="skeleton-row" />
            </div>
          ) : error ? (
            <div className="empty-state">
              <div className="empty-icon">🧱</div>
              <div className="empty-title">Couldn&apos;t load your profile</div>
              <div className="empty-sub">Something went wrong. Try refreshing the page.</div>
              <button className="empty-cta" onClick={() => window.location.reload()}>Refresh →</button>
            </div>
          ) : (
            <>
              {/* Identity card */}
              <div className="identity-card">
                <div className="avatar">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="20" cy="14" r="7" fill="#015237" opacity="0.18"/>
                    <circle cx="20" cy="13" r="6" fill="#015237" opacity="0.5"/>
                    <path d="M6 34c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="#015237" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.5"/>
                  </svg>
                </div>
                <div className="identity-info">
                  <div className="identity-title">Your Main Street Profile</div>
                  <div className="identity-sub">
                    Your activity is tied to this device and browser. No account needed.
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-value">{data?.sessionCount ?? 0}</div>
                  <div className="stat-label">Shopping sessions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{data?.totalTurns ?? 0}</div>
                  <div className="stat-label">Messages with Mason</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{data?.inboxCount ?? 0}</div>
                  <div className="stat-label">
                    Inbox threads
                    {(data?.unreadCount ?? 0) > 0 && (
                      <span className="unread-badge">{data?.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick links */}
              <div className="section">
                <div className="section-title">Your activity</div>
                <div className="link-list">
                  <a href="/history" className="link-row">
                    <div className="link-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{color:'var(--primary)',opacity:0.7}}>
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div className="link-text">
                      <div className="link-label">Chat History</div>
                      <div className="link-sub">{data?.sessionCount ?? 0} {data?.sessionCount === 1 ? 'session' : 'sessions'} · Continue where you left off</div>
                    </div>
                    <span className="link-arrow">→</span>
                  </a>
                  <a href="/inbox" className="link-row">
                    <div className="link-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{color:'var(--primary)',opacity:0.7}}>
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </div>
                    <div className="link-text">
                      <div className="link-label">Inbox</div>
                      <div className="link-sub">
                        {data?.unreadCount
                          ? `${data.unreadCount} unread · ${data.inboxCount} total threads`
                          : `${data?.inboxCount ?? 0} threads`}
                      </div>
                    </div>
                    <span className="link-arrow">→</span>
                  </a>
                </div>
              </div>

              {/* Recent signals */}
              <div className="section">
                <div className="section-title">Recent interactions</div>
                {data?.recentSignals && data.recentSignals.length > 0 ? (
                  <div className="signals-list">
                    {data.recentSignals.map((s, i) => (
                      <div key={i} className="signal-row">
                        <span className="signal-icon">{SIGNAL_ICONS[s.signal_type] ?? '•'}</span>
                        <div className="signal-body">
                          <span className="signal-type">{SIGNAL_LABELS[s.signal_type] ?? s.signal_type}</span>
                          {s.product_name && <span className="signal-product"> · {s.product_name}</span>}
                        </div>
                        <span className="signal-date">{formatDate(s.created_at)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="signals-empty">Browse local shops and save items to see your activity here.</div>
                )}
              </div>

              {/* Privacy section */}
              <div className="section privacy-section">
                <div className="section-title">Privacy</div>
                <p className="privacy-text">
                  Your shopping activity is stored by device fingerprint — no account, no login required.
                  To remove your data, clear your browser history and cookies.
                </p>
                <button
                  className="clear-btn"
                  onClick={() => {
                    localStorage.removeItem('ms_session')
                    window.location.reload()
                  }}
                >
                  Clear local session
                </button>
              </div>
            </>
          )}
        </div>
        <style suppressHydrationWarning>{styles}</style>
      </div>
    </>
  )
}

const styles = `
  :root {
    --bg: #f7f7f5;
    --text: #0f1805;
    --primary: #015237;
    --secondary: #be6e46;
    --cream: #f1e9d8;
    --accent: #7a9e7e;
    --muted: #5c6e52;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(ellipse at 50% 30%, #f2ede4 0%, #f7f7f5 70%); color: var(--text); font-family: 'DM Sans', 'Helvetica Neue', sans-serif; }
  .page { min-height: 100vh; display: flex; flex-direction: column; }

  .header { padding: 16px 40px; display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid rgba(1,82,55,0.1); }
  .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: none; border: none; padding: 10px 0; min-height: 44px; display: inline-flex; align-items: center; }
  .tagline { font-size: 13px; color: var(--muted); font-style: italic; }

  .tab-bar { display: flex; border-bottom: 1px solid rgba(1,82,55,0.1); padding: 0 40px; }
  .tab { padding: 12px 20px; font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
  .tab:hover:not(.tab-active) { color: var(--text); }

  .unread-badge { background: var(--secondary); color: white; font-size: 11px; font-weight: 700; border-radius: 9999px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; margin-left: 6px; vertical-align: middle; }

  .profile-wrap { max-width: 640px; margin: 0 auto; width: 100%; padding: 28px 24px; display: flex; flex-direction: column; gap: 20px; }

  /* Skeleton */
  .skeleton-list { display: flex; flex-direction: column; gap: 12px; }
  .skeleton-row { height: 72px; background: var(--cream); border-radius: 10px; animation: pulse 1.5s infinite; }
  .skeleton-row.tall { height: 100px; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* Identity card */
  .identity-card { background: var(--cream); border-radius: 12px; padding: 20px 24px; display: flex; gap: 16px; align-items: center; border: 1px solid rgba(190,110,70,0.2); }
  .avatar { width: 48px; height: 48px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(1,82,55,0.08); border-radius: 50%; }
  .identity-title { font-family: Georgia, serif; font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .identity-sub { font-size: 13px; color: var(--muted); line-height: 1.5; }

  /* Stats */
  .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .stat-card { background: white; border: 1px solid rgba(122,158,126,0.2); border-radius: 10px; padding: 16px; text-align: center; }
  .stat-value { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: var(--primary); }
  .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.4; display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; }

  /* Sections */
  .section { display: flex; flex-direction: column; gap: 10px; }
  .section-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }

  /* Link list */
  .link-list { display: flex; flex-direction: column; gap: 6px; }
  .link-row { display: flex; align-items: center; gap: 14px; background: white; border: 1px solid rgba(122,158,126,0.2); border-radius: 10px; padding: 14px 18px; text-decoration: none; color: inherit; transition: box-shadow 150ms; }
  .link-row:hover { box-shadow: 0 2px 12px rgba(15,24,5,0.08); }
  .link-icon { flex-shrink: 0; width: 32px; display: flex; align-items: center; justify-content: center; }
  .link-text { flex: 1; }
  .link-label { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
  .link-sub { font-size: 12px; color: var(--muted); }
  .link-arrow { font-size: 16px; color: var(--muted); }

  /* Signals */
  .signals-list { display: flex; flex-direction: column; gap: 6px; }
  .signal-row { display: flex; align-items: center; gap: 10px; background: white; border: 1px solid rgba(122,158,126,0.15); border-radius: 8px; padding: 10px 14px; }
  .signal-icon { font-size: 16px; flex-shrink: 0; width: 24px; text-align: center; }
  .signal-body { flex: 1; font-size: 13px; color: var(--text); }
  .signal-type { font-weight: 600; color: var(--primary); }
  .signal-product { color: var(--muted); }
  .signal-date { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .signals-empty { font-size: 13px; color: var(--muted); font-style: italic; padding: 10px 0; }

  /* Error empty state */
  .empty-state { text-align: center; padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .empty-icon { font-size: 48px; }
  .empty-title { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: var(--text); }
  .empty-sub { font-size: 14px; color: var(--muted); line-height: 1.6; max-width: 280px; }
  .empty-cta { background: var(--primary); color: var(--cream); border: none; border-radius: 6px; padding: 12px 24px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }

  /* Privacy */
  .privacy-section { background: white; border: 1px solid rgba(122,158,126,0.2); border-radius: 10px; padding: 18px 20px; gap: 12px; }
  .privacy-text { font-size: 13px; color: var(--muted); line-height: 1.6; }
  .clear-btn { background: none; border: 1px solid rgba(190,110,70,0.4); border-radius: 6px; padding: 11px 16px; font-size: 13px; color: var(--secondary); cursor: pointer; align-self: flex-start; min-height: 44px; }
  .clear-btn:hover { background: rgba(190,110,70,0.06); }
  .clear-btn:focus-visible { outline: 2px solid var(--secondary); outline-offset: 2px; }

  /* Focus rings for keyboard navigation */
  .logo:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 2px; }
  .tab:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .link-row:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; border-radius: 10px; }

  @media (max-width: 640px) {
    .header { padding: 16px 20px; }
    .tab-bar { padding: 0 20px; }
    .profile-wrap { padding: 16px; }
    .tagline { display: none; }
    .stats-row { grid-template-columns: repeat(3, 1fr); }
    .stat-value { font-size: 22px; }
  }
`
