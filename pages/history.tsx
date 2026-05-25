import { useState, useEffect } from 'react'
import Head from 'next/head'
import type { ConversationRow, MessageParam } from '../lib/types'

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function getSessionSummary(messages: MessageParam[]): string {
  const first = messages.find(m => m.role === 'user')
  if (!first) return 'Shopping session'
  const text = typeof first.content === 'string' ? first.content : ''
  return text.length > 80 ? text.slice(0, 77) + '…' : text
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<ConversationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [continuingId, setContinuingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/history/sessions')
      .then(r => r.json())
      .then(data => {
        setSessions(data.sessions ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const expired = (s: ConversationRow) => new Date(s.expires_at) < new Date()

  async function continueChat(s: ConversationRow) {
    if (continuingId) return
    setContinuingId(s.id)
    try {
      const resp = await fetch('/api/history/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: s.id }),
      })
      const data = await resp.json()
      if (data.sessionId) {
        window.location.href = `/?session=${data.sessionId}`
      } else {
        setContinuingId(null)
      }
    } catch {
      setContinuingId(null)
    }
  }

  return (
    <>
      <Head><title>Chat History — Main Street</title></Head>
      <div className="page">
        <header className="header">
          <button className="logo" onClick={() => window.location.href = '/'}>Main Street</button>
          <div className="tagline">Your local personal shopper</div>
        </header>
        <nav className="tab-bar">
          <a href="/history" className="tab tab-active">Chat History</a>
          <a href="/inbox" className="tab">Inbox</a>
          <a href="/profile" className="tab">Profile</a>
        </nav>
        <div className="list-wrap">
          {loading && (
            <div className="skeleton-list">
              {[1,2,3].map(i => <div key={i} className="skeleton-row" />)}
            </div>
          )}
          {!loading && sessions.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🧱</div>
              <div className="empty-title">No conversations yet</div>
              <div className="empty-sub">Start chatting with Mason to see your history here.</div>
              <a href="/" className="empty-cta">Start shopping →</a>
            </div>
          )}
          {!loading && sessions.map(s => (
            <button
              key={s.id}
              className={`session-row${continuingId === s.id ? ' session-loading' : ''}`}
              onClick={() => continueChat(s)}
              disabled={continuingId !== null}
            >
              <div className="session-main">
                <div className="session-summary">
                  {continuingId === s.id ? 'Opening chat…' : getSessionSummary(s.messages)}
                </div>
                <div className="session-meta">
                  <span className="session-turns">{s.turn_count} {s.turn_count === 1 ? 'message' : 'messages'}</span>
                  {s.last_search_results && s.last_search_results.length > 0 && (
                    <span className="session-products">· {s.last_search_results.length} products found</span>
                  )}
                  {expired(s) && <span className="session-expired">· ended</span>}
                </div>
              </div>
              <div className="session-date">{formatDate(s.created_at)}</div>
            </button>
          ))}
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
    --muted: #9aaa88;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(ellipse at 50% 30%, #f2ede4 0%, #f7f7f5 70%); color: var(--text); font-family: 'DM Sans', 'Helvetica Neue', sans-serif; }
  .page { min-height: 100vh; display: flex; flex-direction: column; }

  .header { padding: 16px 40px; display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid rgba(1,82,55,0.1); }
  .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: none; border: none; padding: 0; }
  .tagline { font-size: 13px; color: var(--muted); font-style: italic; }

  .tab-bar { display: flex; border-bottom: 1px solid rgba(1,82,55,0.1); padding: 0 40px; gap: 0; }
  .tab { padding: 12px 20px; font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; display: flex; align-items: center; gap: 6px; }
  .tab-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
  .tab:hover:not(.tab-active) { color: var(--text); }
  .unread-badge { background: var(--secondary); color: white; font-size: 11px; font-weight: 700; border-radius: 9999px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; }

  .list-wrap { max-width: 680px; margin: 0 auto; width: 100%; padding: 24px; display: flex; flex-direction: column; gap: 8px; }
  .detail-wrap { max-width: 680px; margin: 0 auto; width: 100%; padding: 24px; }

  /* Skeleton */
  .skeleton-list { display: flex; flex-direction: column; gap: 8px; }
  .skeleton-row { height: 72px; background: var(--cream); border-radius: 10px; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  /* Empty state */
  .empty-state { text-align: center; padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .empty-icon { font-size: 48px; }
  .empty-title { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: var(--text); }
  .empty-sub { font-size: 14px; color: var(--muted); line-height: 1.6; max-width: 280px; }
  .empty-cta { background: var(--primary); color: var(--cream); border-radius: 6px; padding: 12px 24px; font-size: 15px; font-weight: 600; text-decoration: none; margin-top: 8px; }

  /* Session rows */
  .session-row { display: flex; align-items: center; gap: 16px; background: white; border: 1px solid rgba(122,158,126,0.2); border-radius: 10px; padding: 16px 20px; cursor: pointer; text-align: left; width: 100%; transition: box-shadow 150ms, opacity 150ms; }
  .session-row:hover:not(:disabled) { box-shadow: 0 2px 12px rgba(15,24,5,0.08); }
  .session-row:disabled { cursor: default; }
  .session-loading { opacity: 0.6; }
  .session-main { flex: 1; min-width: 0; }
  .session-summary { font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
  .session-meta { font-size: 12px; color: var(--muted); display: flex; gap: 4px; }
  .session-products { color: var(--accent); }
  .session-expired { color: var(--muted); }
  .session-date { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }

  @media (max-width: 640px) {
    .header { padding: 16px 20px; }
    .tab-bar { padding: 0 20px; }
    .list-wrap { padding: 16px; }
    .tagline { display: none; }
  }
`
