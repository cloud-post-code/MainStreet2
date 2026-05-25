import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import type { InboxThread, MessageParam } from '../lib/types'

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function threadPreview(thread: InboxThread): string {
  const last = [...thread.messages].reverse().find(m => m.role === 'assistant')
  const text = last ? (typeof last.content === 'string' ? last.content : '') : thread.subject
  return text.length > 80 ? text.slice(0, 77) + '…' : text
}

export default function InboxPage() {
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<InboxThread | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/inbox/threads')
      .then(r => r.json())
      .then(data => {
        setThreads(data.threads ?? [])
        setUnreadCount(data.unreadCount ?? 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selected) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [selected, streamingText])

  async function openThread(thread: InboxThread) {
    setSelected(thread)
    if (!thread.read_at) {
      await fetch('/api/inbox/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: thread.id }),
      })
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, read_at: new Date().toISOString() } : t))
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim() || sending) return
    const text = reply.trim()
    setReply('')
    setSending(true)
    setStreamingText('')

    const userMsg: MessageParam = { role: 'user', content: text }
    const updatedThread = { ...selected, messages: [...selected.messages, userMsg] }
    setSelected(updatedThread)

    try {
      const resp = await fetch('/api/inbox/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: selected.id, message: text }),
      })

      if (!resp.ok || !resp.body) throw new Error('Failed')

      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6))
              if (ev.text) {
                full += ev.text
                setStreamingText(full)
              }
              if ('ok' in ev && ev.ok !== undefined) {
                const assistantMsg: MessageParam = { role: 'assistant', content: full }
                const finalThread: InboxThread = {
                  ...updatedThread,
                  messages: [...updatedThread.messages, assistantMsg],
                  last_activity_at: new Date().toISOString(),
                }
                setSelected(finalThread)
                setThreads(prev => prev.map(t => t.id === finalThread.id ? finalThread : t))
                setStreamingText('')
              }
            } catch { /* malformed */ }
          }
        }
      }
    } catch {
      // restore reply on failure
      setReply(text)
    } finally {
      setSending(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendReply()
    }
  }

  if (selected) {
    return (
      <>
        <Head><title>Inbox — Main Street</title></Head>
        <div className="page">
          <header className="header">
            <button className="logo" onClick={() => window.location.href = '/'}>Main Street</button>
            <div className="tagline">Your local personal shopper</div>
          </header>
          <div className="thread-wrap">
            <button className="back-btn" onClick={() => setSelected(null)}>← Back to inbox</button>
            <div className="thread-subject">{selected.subject}</div>
            <div className="thread-date">{formatDate(selected.created_at)}</div>

            {selected.opening_product && (
              <a
                href={selected.opening_product.url}
                target="_blank"
                rel="noreferrer"
                className="opening-card"
              >
                <div className="opening-img">
                  {selected.opening_product.image_url
                    ? <img src={selected.opening_product.image_url} alt={selected.opening_product.name} />
                    : <span>🛍️</span>}
                </div>
                <div className="opening-info">
                  <div className="opening-shop">{selected.opening_product.business_name}</div>
                  <div className="opening-name">{selected.opening_product.name}</div>
                  <div className="opening-price">${selected.opening_product.price.toFixed(2)}</div>
                </div>
                <div className="opening-arrow">→</div>
              </a>
            )}

            <div className="messages">
              {selected.messages.map((msg, i) => (
                <div key={i} className={`msg msg-${msg.role}`}>
                  <div className={`bubble bubble-${msg.role}`}>
                    {typeof msg.content === 'string' ? msg.content : ''}
                  </div>
                </div>
              ))}
              {streamingText && (
                <div className="msg msg-assistant">
                  <div className="bubble bubble-assistant">
                    {streamingText}
                    <span className="cursor" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="reply-bar">
              <textarea
                className="reply-input"
                placeholder="Reply to Mason…"
                value={reply}
                onChange={e => setReply(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                disabled={sending}
              />
              <button
                className="reply-send"
                onClick={sendReply}
                disabled={!reply.trim() || sending}
              >
                {sending ? '…' : '↑'}
              </button>
            </div>
          </div>
          <style suppressHydrationWarning>{styles}</style>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>Inbox — Main Street</title></Head>
      <div className="page">
        <header className="header">
          <button className="logo" onClick={() => window.location.href = '/'}>Main Street</button>
          <div className="tagline">Your local personal shopper</div>
        </header>
        <nav className="tab-bar">
          <a href="/history" className="tab">Chat History</a>
          <a href="/inbox" className="tab tab-active">
            Inbox
            {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
          </a>
        </nav>
        <div className="list-wrap">
          {loading && (
            <div className="skeleton-list">
              {[1, 2, 3].map(i => <div key={i} className="skeleton-row" />)}
            </div>
          )}
          {!loading && threads.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📬</div>
              <div className="empty-title">Your inbox is empty</div>
              <div className="empty-sub">Mason will reach out with recommendations and updates soon.</div>
              <a href="/" className="empty-cta">Start shopping →</a>
            </div>
          )}
          {!loading && threads.map(t => (
            <button
              key={t.id}
              className={`thread-row${!t.read_at ? ' thread-unread' : ''}`}
              onClick={() => openThread(t)}
            >
              <div className="thread-dot-col">
                {!t.read_at && <span className="unread-dot" />}
              </div>
              <div className="thread-main">
                <div className="thread-subject-line">{t.subject}</div>
                <div className="thread-preview">{threadPreview(t)}</div>
              </div>
              <div className="thread-date-col">{formatDate(t.last_activity_at)}</div>
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
    --muted: #5c6e52;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(ellipse at 50% 30%, #f2ede4 0%, #f7f7f5 70%); color: var(--text); font-family: 'DM Sans', 'Helvetica Neue', sans-serif; }
  .page { min-height: 100vh; display: flex; flex-direction: column; }

  .header { padding: 16px 40px; display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid rgba(1,82,55,0.1); }
  .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: none; border: none; padding: 10px 0; min-height: 44px; display: inline-flex; align-items: center; }
  .tagline { font-size: 13px; color: var(--muted); font-style: italic; }

  .tab-bar { display: flex; border-bottom: 1px solid rgba(1,82,55,0.1); padding: 0 40px; }
  .tab { padding: 12px 20px; min-height: 44px; font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; display: flex; align-items: center; gap: 6px; }
  .tab-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
  .tab:hover:not(.tab-active) { color: var(--text); }
  .unread-badge { background: var(--secondary); color: white; font-size: 11px; font-weight: 700; border-radius: 9999px; min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; }

  .list-wrap { max-width: 680px; margin: 0 auto; width: 100%; padding: 24px; display: flex; flex-direction: column; gap: 2px; }

  .skeleton-list { display: flex; flex-direction: column; gap: 2px; }
  .skeleton-row { height: 72px; background: var(--cream); border-radius: 10px; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

  .empty-state { text-align: center; padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .empty-icon { font-size: 48px; }
  .empty-title { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: var(--text); }
  .empty-sub { font-size: 14px; color: var(--muted); line-height: 1.6; max-width: 280px; }
  .empty-cta { background: var(--primary); color: var(--cream); border-radius: 6px; padding: 12px 24px; font-size: 15px; font-weight: 600; text-decoration: none; margin-top: 8px; }

  .thread-row { display: flex; align-items: center; gap: 12px; background: white; border: 1px solid rgba(122,158,126,0.15); border-radius: 10px; padding: 16px; cursor: pointer; text-align: left; width: 100%; transition: box-shadow 150ms; }
  .thread-row:hover { box-shadow: 0 2px 12px rgba(15,24,5,0.08); }
  .thread-unread { background: #fffdf9; border-color: rgba(190,110,70,0.25); }
  .thread-dot-col { width: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--secondary); }
  .thread-main { flex: 1; min-width: 0; }
  .thread-subject-line { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
  .thread-preview { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .thread-date-col { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; }

  /* Thread detail */
  .thread-wrap { max-width: 680px; margin: 0 auto; width: 100%; padding: 24px; display: flex; flex-direction: column; flex: 1; }
  .back-btn { background: none; border: none; color: var(--primary); font-size: 14px; cursor: pointer; padding: 0; margin-bottom: 16px; font-weight: 500; }
  .thread-subject { font-family: Georgia, serif; font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .thread-date { font-size: 12px; color: var(--muted); margin-bottom: 20px; }

  /* Opening product card */
  .opening-card { display: flex; align-items: center; gap: 12px; background: var(--cream); border: 1px solid rgba(190,110,70,0.25); border-radius: 10px; padding: 12px 14px; text-decoration: none; color: inherit; margin-bottom: 20px; transition: box-shadow 150ms; }
  .opening-card:hover { box-shadow: 0 2px 10px rgba(15,24,5,0.08); }
  .opening-img { width: 56px; height: 56px; border-radius: 6px; background: rgba(190,110,70,0.1); display: flex; align-items: center; justify-content: center; font-size: 20px; overflow: hidden; flex-shrink: 0; }
  .opening-img img { width: 100%; height: 100%; object-fit: cover; }
  .opening-info { flex: 1; min-width: 0; }
  .opening-shop { font-size: 10px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .opening-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .opening-price { font-family: Georgia, serif; font-size: 14px; font-weight: 700; margin-top: 2px; }
  .opening-arrow { color: var(--muted); font-size: 18px; flex-shrink: 0; }

  /* Messages */
  .messages { display: flex; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto; padding-bottom: 12px; }
  .msg { display: flex; }
  .msg-user { justify-content: flex-end; }
  .msg-assistant { justify-content: flex-start; }
  .bubble { padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; max-width: 480px; white-space: pre-wrap; }
  .bubble-user { background: var(--cream); border: 1px solid rgba(190,110,70,0.2); border-radius: 16px 16px 4px 16px; }
  .bubble-assistant { background: white; border: 1px solid rgba(122,158,126,0.25); border-radius: 4px 16px 16px 16px; }
  .cursor { display: inline-block; width: 2px; height: 14px; background: var(--primary); margin-left: 2px; vertical-align: middle; animation: blink 1s infinite; }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

  /* Reply bar */
  .reply-bar { display: flex; gap: 8px; align-items: flex-end; padding-top: 12px; border-top: 1px solid rgba(1,82,55,0.08); margin-top: 8px; }
  .reply-input { flex: 1; background: white; border: 1px solid rgba(122,158,126,0.3); border-radius: 10px; padding: 10px 14px; font-size: 14px; font-family: inherit; resize: none; outline: none; line-height: 1.5; max-height: 120px; color: var(--text); }
  .reply-input:focus { border-color: var(--primary); }
  .reply-input::placeholder { color: var(--muted); }
  .reply-send { width: 38px; height: 38px; border-radius: 50%; background: var(--primary); color: white; border: none; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 150ms; }
  .reply-send:disabled { opacity: 0.4; cursor: default; }

  @media (max-width: 640px) {
    .header { padding: 16px 20px; }
    .tab-bar { padding: 0 20px; }
    .list-wrap { padding: 16px; }
    .thread-wrap { padding: 16px; }
    .tagline { display: none; }
  }
`
