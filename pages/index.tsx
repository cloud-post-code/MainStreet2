import { useState, useRef, useEffect, useCallback } from 'react'
import Head from 'next/head'
import type { ProductResult } from '../lib/types'

type MessageRole = 'user' | 'assistant'
interface ChatMessage {
  role: MessageRole
  text: string
  products?: ProductResult[]
  isStreaming?: boolean
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

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [masonMood, setMasonMood] = useState<MasonMood>('neutral')
  const [isLoading, setIsLoading] = useState(false)
  const [showExpiredNote, setShowExpiredNote] = useState(false)
  const [chatStarted, setChatStarted] = useState(false)
  const [suggestChips, setSuggestChips] = useState<string[]>([])
  const [updatingProducts, setUpdatingProducts] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  // Check for expired session on mount, or a ?session= param from history continuation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resumeId = params.get('session')
    if (resumeId) {
      // Load the continued session from the API and hydrate the chat UI
      fetch('/api/history/sessions')
        .then(r => r.json())
        .then(data => {
          const match = (data.sessions ?? []).find((s: { id: string; messages: Array<{ role: string; content: string | unknown[] }>; turn_count: number }) => s.id === resumeId)
          if (match) {
            const hydrated: ChatMessage[] = match.messages
              .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
              .map((m: { role: string; content: string | unknown[] }) => ({
                role: m.role as MessageRole,
                text: typeof m.content === 'string' ? m.content : '',
              }))
            setMessages(hydrated)
            setTurnCount(match.turn_count)
            setSessionId(resumeId)
            setChatStarted(true)
            // Store so reload doesn't lose the session
            localStorage.setItem('ms_session', JSON.stringify({ id: resumeId, expiresAt: match.expires_at }))
            // Clean up the URL param without a page reload
            window.history.replaceState({}, '', '/')
          }
        })
        .catch(() => { /* silently fall through to normal mount */ })
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

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading || turnCount >= TURN_LIMIT) return

    const userMsg: ChatMessage = { role: 'user', text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSuggestChips([])
    setChatStarted(true)
    setIsLoading(true)
    setMasonMood('thinking')

    // Add streaming placeholder
    setMessages(prev => [...prev, { role: 'assistant', text: '', isStreaming: true }])

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
      let fullText = ''
      let newProducts: ProductResult[] | undefined

      setMasonMood('searching')

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

          const parsed = JSON.parse(data)

          if (eventType === 'session') {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            localStorage.setItem('ms_session', JSON.stringify({ id: parsed.sessionId, expiresAt }))
            setSessionId(parsed.sessionId)
          } else if (eventType === 'delta') {
            fullText += parsed.text
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', text: fullText, isStreaming: true }
              return updated
            })
          } else if (eventType === 'done') {
            setTurnCount(parsed.turnCount)
            setMasonMood(fullText.includes('?') ? 'curious' : 'happy')
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: 'assistant',
                text: fullText,
                products: newProducts,
                isStreaming: false,
              }
              return updated
            })
            // Set contextual suggestion chips
            if (newProducts && newProducts.length > 0) {
              setSuggestChips(['Under $25', 'Something for baking', 'Add all to cart'])
            } else if (fullText.includes('?')) {
              setSuggestChips(['Cooking tools', 'Pantry & oils', 'Either works!'])
            }
          } else if (eventType === 'error') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: 'assistant',
                text: parsed.type === 'turn_limit_exceeded'
                  ? 'I want to make sure I find you the right thing — want to see what I have so far?'
                  : 'Something went wrong. Let\'s try again.',
                isStreaming: false,
              }
              return updated
            })
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', text: 'Something went wrong. Let\'s try again.', isStreaming: false }
        return updated
      })
    } finally {
      setIsLoading(false)
      setUpdatingProducts(false)
    }
  }, [isLoading, sessionId, turnCount])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleChip = (chip: string) => sendMessage(chip)

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
              <a href="/profile" className="nav-link">Profile</a>
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
            <a href="/profile" className="nav-link">Profile</a>
          </div>
        </header>
        <div className="chat-layout">
          {/* Mason sidebar */}
          <div className="mason-sidebar">
            <div className="mason-figure">
              <span className="mason-emoji">{isLoading ? MASON_EXPRESSIONS.searching : MASON_EXPRESSIONS[masonMood]}</span>
            </div>
            <div className="mason-name">Mason</div>
          </div>

          {/* Thread */}
          <div className="thread-col">
            <div className="thread" ref={threadRef}>
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' ? (
                    <div className="msg-user">
                      <div className="bubble-user">{msg.text}</div>
                    </div>
                  ) : (
                    <div className="msg-agent">
                      {msg.isStreaming && msg.text === '' ? (
                        <div className="bubble-typing">
                          <span className="dot" /><span className="dot" /><span className="dot" />
                        </div>
                      ) : (
                        <>
                          <div className="bubble-agent">
                            {msg.text}
                            {msg.isStreaming && <span className="cursor">▊</span>}
                          </div>
                          {msg.products && msg.products.length > 0 && (
                            <div className={`product-strip ${updatingProducts ? 'updating' : ''}`}>
                              <div className="strip-header">{msg.products.length} items from local shops</div>
                              <div className="cards-row">
                                {msg.products.map(p => (
                                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="product-card">
                                    <div className="card-img">
                                      {p.image_url
                                        ? <img src={p.image_url} alt={p.name} />
                                        : <span>🛍️</span>}
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
                              {updatingProducts && <div className="updating-label">Updating for you…</div>}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Input area */}
            {atTurnLimit ? (
              <div className="turn-limit-bar">
                <button className="limit-cta" onClick={() => sendMessage('Show me your best picks')}>
                  See Mason&apos;s best picks →
                </button>
                <button className="restart-link" onClick={() => { localStorage.removeItem('ms_session'); window.location.reload() }}>
                  Start a new search
                </button>
              </div>
            ) : (
              <form className="input-bar" onSubmit={handleSubmit}>
                {suggestChips.length > 0 && (
                  <div className="chips">
                    {suggestChips.map(chip => (
                      <button key={chip} type="button" className="chip" onClick={() => handleChip(chip)}>{chip}</button>
                    ))}
                  </div>
                )}
                <div className="input-row">
                  <input
                    className="chat-input"
                    placeholder="Refine your search or ask a question…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={isLoading}
                  />
                  <button type="submit" className={`send-btn ${input.trim().length < 2 ? 'disabled' : ''}`} disabled={input.trim().length < 2 || isLoading}>
                    →
                  </button>
                </div>
              </form>
            )}
          </div>
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
  .header { padding: 16px 40px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid rgba(1,82,55,0.1); }
  .logo { font-family: Georgia, serif; font-size: 22px; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; background: none; border: none; padding: 0; }
  .header-nav { margin-left: auto; display: flex; gap: 4px; }
  .nav-link { font-size: 13px; font-weight: 500; color: var(--muted); text-decoration: none; padding: 6px 12px; border-radius: 6px; transition: background 150ms, color 150ms; }
  .nav-link:hover { background: rgba(1,82,55,0.06); color: var(--primary); }
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
  .bubble-agent { background: white; border-radius: 4px 16px 16px 16px; padding: 12px 16px; font-size: 14px; line-height: 1.6; border: 1px solid rgba(122,158,126,0.25); max-width: 560px; white-space: pre-wrap; }
  .cursor { animation: blink 1s infinite; }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

  .bubble-typing { background: rgba(122,158,126,0.1); border-radius: 4px 16px 16px 16px; padding: 14px 20px; border: 1px solid rgba(122,158,126,0.2); display: inline-flex; gap: 5px; align-items: center; }
  .dot { width: 7px; height: 7px; background: var(--accent); border-radius: 50%; animation: bounce 1.2s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,60%,100% { opacity: 0.4; transform: none; } 30% { opacity: 1; transform: translateY(-3px); } }

  /* PRODUCT STRIP */
  .product-strip { }
  .strip-header { font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px 14px 0; }
  .cards-row { display: flex; gap: 10px; overflow-x: auto; padding: 8px 14px 12px; scrollbar-width: none; }
  .cards-row::-webkit-scrollbar { display: none; }
  .product-strip.updating .cards-row { opacity: 0.35; }
  .updating-label { font-size: 12px; color: var(--accent); font-style: italic; padding: 0 14px 8px; }

  .product-card { background: var(--cream); border-radius: 8px; padding: 12px; width: 200px; min-width: 200px; border: 1px solid rgba(190,110,70,0.2); text-decoration: none; color: inherit; display: block; transition: box-shadow 150ms; }
  .product-card:hover { box-shadow: 0 4px 16px rgba(15,24,5,0.1); }
  .card-img { height: 90px; background: rgba(190,110,70,0.1); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 8px; overflow: hidden; }
  .card-img img { width: 100%; height: 100%; object-fit: cover; }
  .card-shop { font-family: Georgia, serif; font-size: 10px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .card-name { font-size: 13px; line-height: 1.3; margin-bottom: 8px; }
  .card-footer { display: flex; justify-content: space-between; align-items: center; }
  .card-price { font-family: Georgia, serif; font-size: 16px; font-weight: 700; }
  .local-badge { background: var(--accent); color: white; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 9999px; }

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

  /* TURN LIMIT */
  .turn-limit-bar { background: var(--cream); border: 1px solid rgba(190,110,70,0.25); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
  .limit-cta { background: var(--primary); color: var(--cream); border: none; border-radius: 6px; padding: 12px 20px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; }
  .restart-link { font-size: 12px; color: var(--muted); text-align: center; text-decoration: underline; cursor: pointer; background: none; border: none; }

  @media (max-width: 640px) {
    .chat-layout { grid-template-columns: 44px 1fr; padding: 12px; }
    .mason-sidebar { width: 44px; }
    .mason-figure { width: 36px; height: 36px; font-size: 18px; border-radius: 8px; }
    .mason-name { display: none; }
    .bubble-user, .bubble-agent { max-width: 280px; font-size: 13px; }
    .tagline { display: none; }
  }
`
