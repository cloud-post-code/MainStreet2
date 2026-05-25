import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { getSupabaseClient } from '../lib/supabase'
import type { ConversationRow, MessageParam, ProductResult } from '../lib/types'

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

function getProductsFromMessages(messages: MessageParam[]): ProductResult[] {
  // Products are stored on last_search_results on the conversation row,
  // not on individual messages — we get them from the row directly.
  return []
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<ConversationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ConversationRow | null>(null)
  const [customerId, setCustomerId] = useState<string | null>(null)

  useEffect(() => {
    // Derive customer ID from stored session or fingerprint
    // For history we fetch from the API side — client just loads via fetch
    fetch('/api/history/sessions')
      .then(r => r.json())
      .then(data => {
        setSessions(data.sessions ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const expired = (s: ConversationRow) => new Date(s.expires_at) < new Date()

  if (selected) {
    return (
      <>
        <Head><title>Chat History — Main Street</title></Head>
        <div className="page">
          <header className="header">
            <button className="logo" onClick={() => window.location.href = '/'}>Main Street</button>
            <div className="tagline">Your local personal shopper</div>
          </header>
          <div className="detail-wrap">
            <button className="back-btn" onClick={() => setSelected(null)}>← Back to history</button>
            <div className="detail-meta">
              <span className="detail-date">{formatDate(selected.created_at)}</span>
              {expired(selected) && <span className="expired-badge">Session ended</span>}
            </div>
            <div className="thread">
              {selected.messages.map((msg, i) => (
                <div key={i} className={`msg msg-${msg.role}`}>
                  <div className={`bubble bubble-${msg.role}`}>
                    {typeof msg.content === 'string' ? msg.content : ''}
                  </div>
                </div>
              ))}
              {selected.last_search_results && selected.last_search_results.length > 0 && (
                <div className="products-section">
                  <div className="products-label">Products Mason found</div>
                  <div className="cards-row">
                    {selected.last_search_results.map(p => (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="product-card">
                        <div className="card-img">
                          {p.image_url ? <img src={p.image_url} alt={p.name} /> : <span>🛍️</span>}
                        </div>
                        <div className="card-shop">{p.business_name}</div>
                        <div className="card-name">{p.name}</div>
                        <div className="card-footer">
                          <span className="card-price">${p.price.toFixed(2)}</span>
                          <span className="local-badge">Local ✓</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <style suppressHydrationWarning>{styles}</style>
        </div>
      </>
    )
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
          <a href="/inbox" className="tab">
            Inbox
          </a>
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
            <button key={s.id} className="session-row" onClick={() => setSelected(s)}>
              <div className="session-main">
                <div className="session-summary">{getSessionSummary(s.messages)}</div>
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
  .session-row { display: flex; align-items: center; gap: 16px; background: white; border: 1px solid rgba(122,158,126,0.2); border-radius: 10px; padding: 16px 20px; cursor: pointer; text-align: left; width: 100%; transition: box-shadow 150ms; }
  .session-row:hover { box-shadow: 0 2px 12px rgba(15,24,5,0.08); }
  .session-main { flex: 1; min-width: 0; }
  .session-summary { font-size: 14px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
  .session-meta { font-size: 12px; color: var(--muted); display: flex; gap: 4px; }
  .session-products { color: var(--accent); }
  .session-expired { color: var(--muted); }
  .session-date { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }

  /* Detail view */
  .back-btn { background: none; border: none; color: var(--primary); font-size: 14px; cursor: pointer; padding: 0; margin-bottom: 16px; font-weight: 500; }
  .detail-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .detail-date { font-size: 13px; color: var(--muted); }
  .expired-badge { background: rgba(154,170,136,0.2); color: var(--muted); font-size: 11px; border-radius: 9999px; padding: 2px 8px; }

  .thread { display: flex; flex-direction: column; gap: 12px; }
  .msg { display: flex; }
  .msg-user { justify-content: flex-end; }
  .msg-assistant { justify-content: flex-start; }
  .bubble { padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; max-width: 480px; white-space: pre-wrap; }
  .bubble-user { background: var(--cream); border: 1px solid rgba(190,110,70,0.2); border-radius: 16px 16px 4px 16px; }
  .bubble-assistant { background: white; border: 1px solid rgba(122,158,126,0.25); border-radius: 4px 16px 16px 16px; }

  /* Products */
  .products-section { margin-top: 8px; }
  .products-label { font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; }
  .cards-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: none; }
  .cards-row::-webkit-scrollbar { display: none; }
  .product-card { background: var(--cream); border-radius: 8px; padding: 12px; width: 180px; min-width: 180px; border: 1px solid rgba(190,110,70,0.2); text-decoration: none; color: inherit; display: block; }
  .product-card:hover { box-shadow: 0 2px 10px rgba(15,24,5,0.1); }
  .card-img { height: 80px; background: rgba(190,110,70,0.1); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 8px; overflow: hidden; }
  .card-img img { width: 100%; height: 100%; object-fit: cover; }
  .card-shop { font-size: 10px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .card-name { font-size: 12px; line-height: 1.3; margin-bottom: 8px; }
  .card-footer { display: flex; justify-content: space-between; align-items: center; }
  .card-price { font-family: Georgia, serif; font-size: 15px; font-weight: 700; }
  .local-badge { background: var(--accent); color: white; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 9999px; }

  @media (max-width: 640px) {
    .header { padding: 16px 20px; }
    .tab-bar { padding: 0 20px; }
    .list-wrap, .detail-wrap { padding: 16px; }
    .tagline { display: none; }
  }
`
