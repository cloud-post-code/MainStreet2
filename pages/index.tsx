import { useState, useRef, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { useSession } from 'next-auth/react'
import type { Block, ProductResult, Business, InboxThread, ArtifactData } from '../lib/types'

type MessageRole = 'user' | 'assistant'

type Part =
  | { kind: 'text'; id: string; text: string; ended: boolean }
  | { kind: 'block'; id: string; block: Block }

interface ChatMessage {
  role: MessageRole
  parts: Part[]
  isStreaming?: boolean
  hidden?: boolean
}

type MasonMood = 'neutral' | 'thinking' | 'searching' | 'happy' | 'curious'

const MASON_EXPRESSIONS: Record<MasonMood, string> = {
  neutral: '🧱',
  thinking: '🧱💭',
  searching: '🧱🔍',
  happy: '🧱😊',
  curious: '🧱🤔',
}

const TURN_LIMIT = 8

function userMessage(text: string): ChatMessage {
  return { role: 'user', parts: [{ kind: 'text', id: 'u', text, ended: true }] }
}

function emptyAssistant(): ChatMessage {
  return { role: 'assistant', parts: [], isStreaming: true }
}

function threadPreview(thread: InboxThread): string {
  const last = [...thread.messages].reverse().find(m => m.role === 'assistant')
  const text = last ? (typeof last.content === 'string' ? last.content : '') : thread.subject
  return text.length > 80 ? text.slice(0, 77) + '…' : text
}

export default function Home() {
  const { data: session, status: authStatus } = useSession()
  const isAuthenticated = authStatus === 'authenticated'
  const authUser = session?.user as { id?: string; name?: string; email?: string } | undefined

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [masonMood, setMasonMood] = useState<MasonMood>('neutral')
  const [isLoading, setIsLoading] = useState(false)
  const [showExpiredNote, setShowExpiredNote] = useState(false)
  const [chatStarted, setChatStarted] = useState(false)
  const [showSignupNudge, setShowSignupNudge] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [inboxThreads, setInboxThreads] = useState<InboxThread[]>([])
  const [inboxUnread, setInboxUnread] = useState(0)
  const [inboxOpen, setInboxOpen] = useState(true)
  const threadRef = useRef<HTMLDivElement>(null)

  // Detect admin session (separate auth from shopper session)
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user?.role === 'admin') setIsAdmin(true) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/inbox/threads')
      .then(r => r.json())
      .then(d => {
        setInboxThreads(d.threads ?? [])
        setInboxUnread(d.unreadCount ?? 0)
      })
      .catch(() => {})
  }, [])

  // Check for expired session on mount, or a ?session= param from history continuation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeId = params.get('session')
    if (resumeId) {
      fetch('/api/history/sessions')
        .then(r => r.json())
        .then(data => {
          const match = (data.sessions ?? []).find((s: { id: string; messages: Array<{ role: string; content: unknown }>; turn_count: number; expires_at: string }) => s.id === resumeId)
          if (match) {
            const hydrated: ChatMessage[] = match.messages
              .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
              .map((m: { role: string; content: unknown }) => {
                const text = typeof m.content === 'string'
                  ? m.content
                  : Array.isArray(m.content)
                    ? (m.content as Array<{ type: string; text?: string }>)
                        .filter(c => c.type === 'text')
                        .map(c => c.text ?? '')
                        .join('')
                    : ''
                return {
                  role: m.role as MessageRole,
                  parts: [{ kind: 'text' as const, id: 'h', text, ended: true }],
                }
              })
              .filter((m: ChatMessage) => {
                const first = m.parts[0]
                return first?.kind === 'text' && first.text.trim().length > 0
              })
            setMessages(hydrated)
            setTurnCount(match.turn_count)
            setSessionId(resumeId)
            setChatStarted(true)
            localStorage.setItem('ms_session', JSON.stringify({ id: resumeId, expiresAt: match.expires_at }))
            window.history.replaceState({}, '', '/')
          }
        })
        .catch(() => {})
      return
    }

    const stored = localStorage.getItem('ms_session')
    if (stored) {
      try {
        const { id, expiresAt } = JSON.parse(stored)
        if (new Date(expiresAt) < new Date()) {
          localStorage.removeItem('ms_session')
          setShowExpiredNote(true)
        } else {
          setSessionId(id)
        }
      } catch {
        localStorage.removeItem('ms_session')
      }
    }
  }, [])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  // Helper: update the last (assistant) message in-place
  const updateLast = useCallback((updater: (msg: ChatMessage) => ChatMessage) => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const next = [...prev]
      next[next.length - 1] = updater(next[next.length - 1])
      return next
    })
  }, [])

  const sendMessage = useCallback(async (text: string, hidden = false) => {
    if (!text.trim() || isLoading || turnCount >= TURN_LIMIT) return

    const userMsg: ChatMessage = { role: 'user', parts: [{ kind: 'text', id: 'u', text, ended: true }], hidden }
    setMessages(prev => [...prev, userMsg, emptyAssistant()])
    setInput('')
    setChatStarted(true)
    setIsLoading(true)
    setMasonMood('thinking')

    try {
      const body: { message: string; sessionId?: string } = { message: text }
      if (sessionId) body.sessionId = sessionId

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.body) throw new Error('No stream')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const raw of events) {
          const lines = raw.split('\n')
          let eventType = 'message'
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (!data) continue
          let parsed: { [k: string]: unknown }
          try { parsed = JSON.parse(data) } catch { continue }

          if (eventType === 'session') {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            localStorage.setItem('ms_session', JSON.stringify({ id: parsed.sessionId, expiresAt }))
            setSessionId(parsed.sessionId as string)
          } else if (eventType === 'text_start') {
            const id = parsed.id as string
            updateLast(msg => ({ ...msg, parts: [...msg.parts, { kind: 'text', id, text: '', ended: false }] }))
          } else if (eventType === 'text_delta') {
            const id = parsed.id as string
            const chunk = parsed.text as string
            updateLast(msg => ({
              ...msg,
              parts: msg.parts.map(p =>
                p.kind === 'text' && p.id === id ? { ...p, text: p.text + chunk } : p,
              ),
            }))
          } else if (eventType === 'text_end') {
            const id = parsed.id as string
            updateLast(msg => ({
              ...msg,
              parts: msg.parts.map(p =>
                p.kind === 'text' && p.id === id ? { ...p, ended: true } : p,
              ),
            }))
          } else if (eventType === 'block') {
            const block: Block = { type: parsed.type as Block['type'], data: parsed.data as Block['data'] } as Block
            const id = parsed.id as string
            updateLast(msg => ({ ...msg, parts: [...msg.parts, { kind: 'block', id, block }] }))
            if (block.type === 'question') setMasonMood('curious')
            if (block.type === 'product_strip' || block.type === 'shop_card') setMasonMood('happy')
            if (block.type === 'artifact') {
              const kind = (block.data as ArtifactData).kind
              setMasonMood(kind === 'choice_picker' ? 'curious' : 'happy')
            }
          } else if (eventType === 'tool_start') {
            setMasonMood('searching')
          } else if (eventType === 'tool_end') {
            setMasonMood('thinking')
          } else if (eventType === 'done') {
            const turn = typeof parsed.turnCount === 'number' ? parsed.turnCount : (turnCount + 1)
            setTurnCount(turn)
            updateLast(msg => ({ ...msg, isStreaming: false }))
            setMasonMood(prev => prev === 'curious' ? 'curious' : 'happy')
            if (!isAuthenticated && turn === 1) {
              const dismissed = typeof window !== 'undefined' && sessionStorage.getItem('ms_nudge_dismissed')
              if (!dismissed) setShowSignupNudge(true)
            }
          } else if (eventType === 'error') {
            const errText = parsed.type === 'turn_limit_exceeded'
              ? 'I want to make sure I find you the right thing — want to see what I have so far?'
              : 'Something went wrong. Let\'s try again.'
            updateLast(msg => ({
              ...msg,
              parts: [{ kind: 'text', id: 'err', text: errText, ended: true }],
              isStreaming: false,
            }))
          }
        }
      }
    } catch {
      updateLast(msg => ({
        ...msg,
        parts: [{ kind: 'text', id: 'err', text: 'Something went wrong. Let\'s try again.', ended: true }],
        isStreaming: false,
      }))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, sessionId, turnCount, updateLast, isAuthenticated])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleChip = (chip: string) => sendMessage(chip)
  const handleChoice = (value: string) => sendMessage(value, true)

  const atTurnLimit = turnCount >= TURN_LIMIT

  if (!chatStarted) {
    return (
      <>
        <Head><title>Main Street — Your Local Personal Shopper</title></Head>
        <div className="page">
          <header className="header">
            <button className="logo" onClick={() => window.location.reload()}>Main Street</button>
            <div className="tagline">Your local personal shopper</div>
            <div className="header-nav">
              <a href="/history" className="nav-link">History</a>
              <a href="/inbox" className="nav-link">Inbox</a>
              {isAdmin && <a href="/admin" className="nav-link nav-link-admin">Admin</a>}
              {!isAdmin && (isAuthenticated
                ? <a href="/profile" className="nav-link nav-link-account">{authUser?.name ?? 'Account'}</a>
                : <a href="/login" className="nav-link nav-link-signin">Sign in</a>
              )}
            </div>
          </header>
          <div className="card-wrap">
            <div className="ask-card">
              <div className="mason-corner">{MASON_EXPRESSIONS.neutral}</div>
              <h1 className="ask-heading">Tell me what<br />you need.</h1>
              <p className="ask-sub">
                I&apos;ll find it from local shops you can trust.
                {showExpiredNote && (
                  <span className="expired-note"><br />Your last session ended — no worries, just start again.</span>
                )}
              </p>
              <form onSubmit={handleSubmit}>
                <label htmlFor="main-ask" className="sr-only">What are you looking for?</label>
                <textarea
                  id="main-ask"
                  className="ask-textarea"
                  placeholder="A birthday gift for my sister who loves cooking..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                  rows={4}
                />
                <div className="ask-footer">
                  <button type="submit" className="submit-btn" disabled={input.trim().length < 2}>
                    Find it &nbsp;→
                  </button>
                  <span className="trust-note">50 local businesses · 3 towns</span>
                </div>
              </form>
            </div>
          </div>
          <style suppressHydrationWarning>{styles}</style>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>Main Street — Your Local Personal Shopper</title></Head>
      <div className="page">
        <header className="header">
          <button className="logo" onClick={() => window.location.reload()}>Main Street</button>
          <div className="tagline">Your local personal shopper</div>
          <div className="header-nav">
            <a href="/history" className="nav-link">History</a>
            <a href="/inbox" className="nav-link">Inbox</a>
            {isAdmin && <a href="/admin" className="nav-link nav-link-admin">Admin</a>}
            {!isAdmin && (isAuthenticated
              ? <a href="/profile" className="nav-link nav-link-account">{authUser?.name ?? 'Account'}</a>
              : <a href="/login" className="nav-link nav-link-signin">Sign in</a>
            )}
          </div>
        </header>
        {inboxThreads.length > 0 && (
          <div className="inbox-strip">
            <button className="inbox-strip-toggle" onClick={() => setInboxOpen(o => !o)}>
              <span className="inbox-strip-label">
                📬 Inbox
                {inboxUnread > 0 && <span className="inbox-strip-badge">{inboxUnread}</span>}
              </span>
              <span className="inbox-strip-chevron">{inboxOpen ? '▾' : '▸'}</span>
            </button>
            {inboxOpen && (
              <div className="inbox-strip-cards">
                {inboxThreads.slice(0, 4).map(t => (
                  <a key={t.id} href="/inbox" className={`inbox-card${!t.read_at ? ' inbox-card-unread' : ''}`}>
                    <div className="inbox-card-subject">{t.subject}</div>
                    <div className="inbox-card-preview">{threadPreview(t)}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="chat-layout">
          <div className="mason-sidebar">
            <div className="mason-figure">
              <span className="mason-emoji">{isLoading ? MASON_EXPRESSIONS.searching : MASON_EXPRESSIONS[masonMood]}</span>
            </div>
            <div className="mason-name">Mason</div>
          </div>

          <div className="thread-col">
            <div className="thread" ref={threadRef}>
              {messages.map((msg, i) => {
                if (msg.hidden) return null
                return (
                  <div key={i} className={msg.role === 'user' ? 'msg-user' : 'msg-agent'}>
                    {msg.role === 'user' ? (
                      <div className="bubble-user">{msg.parts[0]?.kind === 'text' ? msg.parts[0].text : ''}</div>
                    ) : (
                      <AssistantMessage msg={msg} onChip={handleChip} onChoice={handleChoice} />
                    )}
                  </div>
                )
              })}
            </div>

            <form className="input-bar" onSubmit={handleSubmit}>
              {showSignupNudge && !isAuthenticated && (
                <div className="signup-nudge">
                  <span>🧱 Want to save this conversation? </span>
                  <a href="/signup" className="nudge-link">Create a free account →</a>
                  <button
                    type="button"
                    className="nudge-dismiss"
                    onClick={() => {
                      sessionStorage.setItem('ms_nudge_dismissed', '1')
                      setShowSignupNudge(false)
                    }}
                  >×</button>
                </div>
              )}
              <div className="input-row">
                <input
                  className="chat-input"
                  placeholder={atTurnLimit ? 'Start a new search to continue…' : 'Refine your search or ask a question…'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={isLoading || atTurnLimit}
                />
                {atTurnLimit ? (
                  <button
                    type="button"
                    className="send-btn"
                    onClick={() => { localStorage.removeItem('ms_session'); window.location.reload() }}
                  >↺</button>
                ) : (
                  <button type="submit" className={`send-btn ${input.trim().length < 2 ? 'disabled' : ''}`} disabled={input.trim().length < 2 || isLoading}>
                    →
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
        <style suppressHydrationWarning>{styles}</style>
      </div>
    </>
  )
}

function AssistantMessage({ msg, onChip, onChoice }: { msg: ChatMessage; onChip: (s: string) => void; onChoice: (s: string) => void }) {
  // Empty + streaming = typing indicator
  if (msg.parts.length === 0 && msg.isStreaming) {
    return (
      <div className="bubble-typing">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
    )
  }
  return (
    <div className="agent-parts">
      {msg.parts.map((part, i) => {
        if (part.kind === 'text') {
          return (
            <div key={i} className="bubble-agent">
              {part.text}
              {!part.ended && msg.isStreaming && <span className="cursor">▊</span>}
            </div>
          )
        }
        return <BlockView key={i} block={part.block} onChip={onChip} onChoice={onChoice} />
      })}
    </div>
  )
}

function BlockView({ block, onChip, onChoice }: { block: Block; onChip: (s: string) => void; onChoice: (s: string) => void }) {
  if (block.type === 'plan') {
    // Hidden from customer UI — Mason's internal planning step
    return null
  }
  if (block.type === 'question') {
    return (
      <div className="question-card">
        <div className="question-text">{block.data.question}</div>
        {block.data.options && block.data.options.length > 0 && (
          <div className="chips">
            {block.data.options.map(opt => (
              <button key={opt} type="button" className="chip" onClick={() => onChip(opt)}>{opt}</button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (block.type === 'artifact') {
    return <ArtifactView data={block.data} onChoice={onChoice} />
  }
  if (block.type === 'product_strip') {
    return <ProductStrip headline={block.data.headline} products={block.data.products} />
  }
  if (block.type === 'shop_card') {
    return <ShopCard shop={block.data.shop} reason={block.data.reason} />
  }
  return null
}

function ArtifactView({ data, onChoice }: { data: ArtifactData; onChoice: (s: string) => void }) {
  if (data.kind === 'product_grid') {
    const products = data.products ?? []
    if (products.length === 0) return null
    return (
      <div className="product-strip">
        {data.headline && <div className="strip-header">{data.headline}</div>}
        <div className="cards-row">
          {products.map(p => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="product-card">
              <div className="card-img">
                {p.image_url ? <img src={p.image_url} alt={p.name} /> : <span>🛍️</span>}
              </div>
              <div className="card-shop">{p.business_name}</div>
              <div className="card-name">{p.name}</div>
              <div className="card-footer">
                <span className="card-price">${Number(p.price).toFixed(2)}</span>
                <span className="local-badge">Local ✓</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    )
  }

  if (data.kind === 'choice_picker') {
    const choices = data.choices ?? []
    if (choices.length === 0) return null
    return (
      <div className="choice-picker">
        {data.question && <div className="choice-question">{data.question}</div>}
        <div className="choice-grid">
          {choices.map((c, i) => (
            <button key={i} type="button" className="choice-card" onClick={() => onChoice(c.value)}>
              {c.image_url && (
                <div className="choice-img">
                  <img src={c.image_url} alt={c.label} />
                </div>
              )}
              <div className="choice-label">{c.label}</div>
              {c.description && <div className="choice-desc">{c.description}</div>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return null
}

function ProductStrip({ headline, products }: { headline?: string; products: ProductResult[] }) {
  if (!products || products.length === 0) return null
  return (
    <div className="product-strip">
      <div className="strip-header">{headline ?? `${products.length} items from local shops`}</div>
      <div className="cards-row">
        {products.map(p => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="product-card">
            <div className="card-img">
              {p.image_url ? <img src={p.image_url} alt={p.name} /> : <span>🛍️</span>}
            </div>
            <div className="card-shop">{p.business_name}</div>
            <div className="card-name">{p.name}</div>
            <div className="card-footer">
              <span className="card-price">${Number(p.price).toFixed(2)}</span>
              <span className="local-badge">Local ✓</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function ShopCard({ shop, reason }: { shop: Business; reason?: string }) {
  const address = [shop.address_street, shop.address_city, shop.address_state, shop.address_zip].filter(Boolean).join(', ')
  return (
    <a href={shop.url} target="_blank" rel="noreferrer" className="shop-card">
      <div className="shop-card-name">{shop.name}</div>
      <div className="shop-card-town">{shop.town}</div>
      {address && <div className="shop-card-address">{address}</div>}
      {reason && <div className="shop-card-reason">{reason}</div>}
    </a>
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
  .header { padding: 16px 40px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid rgba(1,82,55,0.1); }
  .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: none; border: none; padding: 0; }
  .header-nav { margin-left: auto; display: flex; gap: 4px; }
  .nav-link { font-size: 13px; font-weight: 500; color: var(--muted); text-decoration: none; padding: 6px 12px; border-radius: 6px; transition: background 150ms, color 150ms; }
  .nav-link:hover { background: rgba(1,82,55,0.06); color: var(--primary); }
  .nav-link-signin { color: var(--primary); font-weight: 600; }
  .nav-link-account { color: var(--primary); font-weight: 600; }
  .nav-link-admin { color: var(--muted); font-weight: 500; }
  .signup-nudge { display: flex; align-items: center; gap: 8px; background: #f0f7f4; border: 1px solid #b7dfc9; border-radius: 8px; padding: 10px 14px; font-size: 14px; color: #1a4a35; margin-bottom: 8px; }
  .nudge-link { color: var(--primary); font-weight: 600; text-decoration: none; flex: 1; }
  .nudge-dismiss { background: none; border: none; cursor: pointer; color: #888; font-size: 18px; padding: 0 4px; line-height: 1; margin-left: auto; }
  .logo:hover { opacity: 0.8; }
  .tagline { font-size: 13px; color: var(--muted); font-style: italic; }

  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  /* INITIAL CARD */
  .card-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
  .ask-card { background: var(--cream); border-radius: 16px; padding: 40px; max-width: 520px; width: 100%; box-shadow: 0 4px 32px rgba(15,24,5,0.08); position: relative; }
  .mason-corner { position: absolute; top: 20px; right: 24px; font-size: 56px; }
  .ask-heading { font-family: Georgia, serif; font-size: 30px; font-weight: 700; line-height: 1.2; margin-bottom: 8px; }
  .ask-sub { font-size: 14px; color: #5a6b4a; line-height: 1.6; margin-bottom: 20px; }
  .expired-note { font-style: italic; color: var(--muted); font-size: 12px; }
  .ask-textarea { width: 100%; min-height: 100px; background: white; border: 1px solid rgba(190,110,70,0.2); border-radius: 8px; padding: 14px; font-size: 14px; font-family: inherit; resize: none; outline: none; line-height: 1.7; color: var(--text); display: block; }
  .ask-textarea::placeholder { color: var(--muted); font-style: italic; }
  .ask-textarea:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .ask-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
  .submit-btn { background: var(--primary); color: var(--cream); border: none; border-radius: 6px; padding: 13px 24px; font-size: 15px; font-weight: 600; cursor: pointer; min-height: 44px; }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .submit-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .trust-note { font-size: 12px; color: var(--accent); font-weight: 500; }

  /* CHAT LAYOUT */
  .chat-layout { flex: 1; display: grid; grid-template-columns: 64px 1fr; max-width: 900px; margin: 0 auto; width: 100%; padding: 24px 24px 0; gap: 0; }

  /* MASON SIDEBAR */
  .mason-sidebar { width: 64px; display: flex; flex-direction: column; align-items: center; padding-top: 12px; }
  .mason-figure { width: 52px; height: 52px; background: var(--cream); border: 2px solid rgba(190,110,70,0.3); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 26px; }
  .mason-emoji { line-height: 1; }
  .mason-name { font-size: 11px; color: var(--muted); margin-top: 4px; font-style: italic; }

  /* THREAD */
  .thread-col { display: flex; flex-direction: column; padding-left: 16px; }
  .thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; max-height: calc(100vh - 180px); padding-bottom: 16px; }

  .msg-user { display: flex; justify-content: flex-end; }
  .bubble-user { background: var(--cream); border-radius: 16px 16px 4px 16px; padding: 12px 16px; max-width: 480px; font-size: 14px; line-height: 1.6; border: 1px solid rgba(190,110,70,0.2); }

  .msg-agent { display: flex; flex-direction: column; gap: 8px; }
  .agent-parts { display: flex; flex-direction: column; gap: 8px; }
  .bubble-agent { background: white; border-radius: 4px 16px 16px 16px; padding: 12px 16px; font-size: 14px; line-height: 1.6; border: 1px solid rgba(122,158,126,0.25); max-width: 560px; white-space: pre-wrap; }
  .cursor { animation: blink 1s infinite; }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

  .bubble-typing { background: rgba(122,158,126,0.1); border-radius: 4px 16px 16px 16px; padding: 14px 20px; border: 1px solid rgba(122,158,126,0.2); display: inline-flex; gap: 5px; align-items: center; align-self: flex-start; }
  .dot { width: 7px; height: 7px; background: var(--accent); border-radius: 50%; animation: bounce 1.2s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,60%,100% { opacity: 0.4; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }

  /* PLAN BLOCK */
  .plan-card { background: rgba(1,82,55,0.04); border: 1px solid rgba(1,82,55,0.15); border-radius: 12px; padding: 12px 16px; max-width: 560px; font-size: 13px; }
  .plan-header { font-family: Georgia, serif; font-size: 11px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .plan-goal { font-size: 14px; color: var(--text); margin-bottom: 8px; line-height: 1.4; }
  .plan-steps { margin: 0; padding-left: 20px; color: #3a4732; line-height: 1.6; }
  .plan-steps li { margin-bottom: 2px; }

  /* QUESTION BLOCK */
  .question-card { background: white; border-radius: 4px 16px 16px 16px; padding: 12px 16px; border: 1px solid rgba(122,158,126,0.25); max-width: 560px; display: flex; flex-direction: column; gap: 10px; }
  .question-text { font-size: 14px; line-height: 1.6; }

  /* SHOP CARD BLOCK */
  .shop-card { background: var(--cream); border-radius: 12px; padding: 14px 18px; border: 1px solid rgba(190,110,70,0.2); text-decoration: none; color: inherit; display: block; max-width: 360px; transition: box-shadow 150ms; }
  .shop-card:hover { box-shadow: 0 4px 16px rgba(15,24,5,0.1); }
  .shop-card-name { font-family: Georgia, serif; font-size: 16px; font-weight: 700; color: var(--primary); margin-bottom: 2px; }
  .shop-card-town { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  .shop-card-address { font-size: 12px; color: #5a6b4a; margin-bottom: 6px; }
  .shop-card-reason { font-size: 13px; color: var(--text); font-style: italic; }

  /* PRODUCT STRIP */
  .product-strip { }
  .strip-header { font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px 14px 0; }
  .cards-row { display: flex; gap: 10px; overflow-x: auto; padding: 8px 14px 12px; scrollbar-width: none; }
  .cards-row::-webkit-scrollbar { display: none; }

  .product-card { background: var(--cream); border-radius: 8px; padding: 12px; width: 200px; min-width: 200px; border: 1px solid rgba(190,110,70,0.2); text-decoration: none; color: inherit; display: block; transition: box-shadow 150ms; }
  .product-card:hover { box-shadow: 0 4px 16px rgba(15,24,5,0.1); }
  .card-img { height: 90px; background: rgba(190,110,70,0.1); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 8px; overflow: hidden; }
  .card-img img { width: 100%; height: 100%; object-fit: cover; }
  .card-shop { font-family: Georgia, serif; font-size: 10px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .card-name { font-size: 13px; line-height: 1.3; margin-bottom: 8px; }
  .card-footer { display: flex; justify-content: space-between; align-items: center; }
  .card-price { font-family: Georgia, serif; font-size: 16px; font-weight: 700; }
  .local-badge { background: var(--accent); color: white; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 9999px; }

  /* CHOICE PICKER ARTIFACT */
  .choice-picker { max-width: 560px; }
  .choice-question { font-size: 14px; line-height: 1.6; margin-bottom: 10px; color: var(--text); }
  .choice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .choice-card { background: var(--cream); border: 1.5px solid rgba(190,110,70,0.2); border-radius: 10px; padding: 12px 10px; cursor: pointer; text-align: left; transition: border-color 150ms, box-shadow 150ms; display: flex; flex-direction: column; gap: 6px; }
  .choice-card:hover { border-color: var(--primary); box-shadow: 0 2px 10px rgba(1,82,55,0.12); }
  .choice-img { height: 80px; border-radius: 6px; overflow: hidden; background: rgba(190,110,70,0.1); display: flex; align-items: center; justify-content: center; }
  .choice-img img { width: 100%; height: 100%; object-fit: cover; }
  .choice-label { font-family: Georgia, serif; font-size: 13px; font-weight: 700; color: var(--primary); line-height: 1.3; }
  .choice-desc { font-size: 11px; color: var(--muted); line-height: 1.4; }

  /* INPUT BAR */
  .input-bar { background: white; border: 1px solid rgba(122,158,126,0.3); border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { background: var(--cream); border: 1px solid var(--primary); border-radius: 20px; padding: 4px 12px; font-size: 12px; color: var(--primary); cursor: pointer; font-weight: 500; }
  .chip:hover { background: var(--primary); color: var(--cream); }
  .input-row { display: flex; align-items: center; gap: 8px; }
  .chat-input { flex: 1; border: none; outline: none; font-size: 14px; background: none; color: var(--text); padding: 4px 0; }
  .chat-input::placeholder { color: var(--muted); font-style: italic; }
  .send-btn { background: var(--primary); color: var(--cream); border: none; border-radius: 6px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 16px; flex-shrink: 0; }
  .send-btn.disabled { opacity: 0.4; cursor: not-allowed; }

  .chat-input:disabled { opacity: 0.5; }

  /* INBOX STRIP */
  .inbox-strip { max-width: 900px; margin: 0 auto; width: 100%; padding: 0 24px; }
  .inbox-strip-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: none; border: none; border-bottom: 1px solid rgba(1,82,55,0.1); padding: 10px 0; cursor: pointer; }
  .inbox-strip-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--primary); letter-spacing: 0.04em; text-transform: uppercase; }
  .inbox-strip-badge { background: var(--secondary); color: white; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 9999px; }
  .inbox-strip-chevron { font-size: 12px; color: var(--muted); }
  .inbox-strip-cards { display: flex; gap: 10px; padding: 10px 0 4px; overflow-x: auto; }
  .inbox-card { flex: 0 0 200px; background: white; border: 1px solid rgba(122,158,126,0.25); border-radius: 10px; padding: 10px 12px; text-decoration: none; color: var(--text); transition: box-shadow 150ms; }
  .inbox-card:hover { box-shadow: 0 2px 10px rgba(1,82,55,0.10); }
  .inbox-card-unread { border-left: 3px solid var(--secondary); }
  .inbox-card-subject { font-size: 13px; font-weight: 600; color: var(--primary); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .inbox-card-preview { font-size: 12px; color: var(--muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  @media (max-width: 640px) {
    .chat-layout { grid-template-columns: 44px 1fr; padding: 12px; }
    .mason-sidebar { width: 44px; }
    .mason-figure { width: 36px; height: 36px; font-size: 18px; border-radius: 8px; }
    .mason-name { display: none; }
    .bubble-user, .bubble-agent { max-width: 280px; font-size: 13px; }
    .tagline { display: none; }
    .inbox-strip { padding: 0 12px; }
    .inbox-card { flex: 0 0 160px; }
  }
`
