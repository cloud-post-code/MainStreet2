import { GetServerSideProps } from 'next'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'
import type { RawProduct } from '../../../lib/types'

interface Business {
  id: string
  name: string
  url: string
  selectors: Record<string, string>
  scrape_notes: string | null
}

interface Props {
  business?: Business
  businesses: Array<{ id: string; name: string }>
}

export default function ScraperNew({ business, businesses }: Props) {
  const [url, setUrl] = useState(business?.url ?? '')
  const [notes, setNotes] = useState(business?.scrape_notes ?? '')
  const [businessId, setBusinessId] = useState(business?.id ?? '')
  const [selectors, setSelectors] = useState<Record<string, string>>(business?.selectors ?? {})

  const [genLoading, setGenLoading] = useState(false)
  const [genError, setGenError] = useState('')

  const [dryProducts, setDryProducts] = useState<RawProduct[] | null>(null)
  const [dryLoading, setDryLoading] = useState(false)
  const [dryError, setDryError] = useState('')

  const [scrapeMode, setScrapeMode] = useState<'company' | 'products'>('company')
  const [productUrlsText, setProductUrlsText] = useState('')

  const [logLines, setLogLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runDone, setRunDone] = useState(false)
  const [runSummary, setRunSummary] = useState('')
  const [progress, setProgress] = useState({ percent: 0, step: '', totalProducts: 0, doneProducts: 0, startedAt: 0 })
  const logRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  function parseLogMsg(msg: string, prev: typeof progress): typeof progress {
    const next = { ...prev }
    if (msg.startsWith('Starting scrape for')) {
      next.step = msg; next.percent = 2
    } else if (msg.startsWith('Discovering products from')) {
      next.step = 'Discovering products...'; next.percent = 5
    } else if (msg.startsWith('Found') && msg.includes('collection')) {
      next.step = msg; next.percent = 15
    } else if (msg.startsWith('Discovery complete:') || msg.startsWith('Discovered')) {
      const m = msg.match(/(\d+) product/)
      if (m) next.totalProducts = parseInt(m[1], 10)
      next.step = `Found ${next.totalProducts} products to scrape`; next.percent = 28
    } else if (msg.startsWith('Scraping') && msg.includes('product detail pages')) {
      const m = msg.match(/Scraping (\d+)/)
      if (m) next.totalProducts = parseInt(m[1], 10)
      next.step = `Scraping ${next.totalProducts} products...`; next.percent = 30
    } else if (msg.startsWith('+ new:') || msg.startsWith('~ price:') || msg.startsWith('SKIP ')) {
      next.doneProducts = prev.doneProducts + 1
      if (next.totalProducts > 0) {
        next.percent = Math.round(30 + Math.min(next.doneProducts / next.totalProducts, 1) * 65)
      }
      const label = msg.startsWith('+ new:') ? msg.slice(7).split(' $')[0]
        : msg.startsWith('~ price:') ? msg.slice(9).split(' $')[0] : ''
      next.step = `${next.doneProducts} / ${next.totalProducts > 0 ? next.totalProducts : '?'}${label ? ` — ${label}` : ''}`
    }
    return next
  }

  function getTimeEst(p: typeof progress): string | null {
    if (!p.startedAt || p.doneProducts === 0 || p.totalProducts === 0) return null
    const elapsed = (Date.now() - p.startedAt) / 1000
    const rate = p.doneProducts / elapsed
    const remaining = p.totalProducts - p.doneProducts
    if (rate <= 0 || remaining <= 0) return null
    const secs = Math.round(remaining / rate)
    if (secs < 5) return 'almost done'
    if (secs < 60) return `~${secs}s left`
    return `~${Math.ceil(secs / 60)}m left`
  }

  async function handleGenerate() {
    if (!url) return
    setGenLoading(true)
    setGenError('')
    setSelectors({})
    setDryProducts(null)
    setRunDone(false)

    const res = await fetch('/api/admin/scraper/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, notes, businessId: businessId || undefined }),
    })
    const data = await res.json()
    setGenLoading(false)
    if (!res.ok) { setGenError(data.error); return }
    setSelectors(data.selectors)

    if (businessId) {
      if (scrapeMode === 'company') {
        handleRun()
      } else {
        handleRunProducts()
      }
    }
  }

  async function handleRunProducts() {
    if (!businessId) return
    const productUrls = productUrlsText
      .split(/[\n,]/)
      .map((u: string) => u.trim())
      .filter((u: string) => /^https?:\/\//.test(u))
    if (productUrls.length === 0) return

    setLogLines([`Scraping ${productUrls.length} product URL${productUrls.length !== 1 ? 's' : ''}...`])
    setRunning(true)
    setRunDone(false)
    setRunSummary('')

    const res = await fetch('/api/admin/scraper/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, mode: 'products', productUrls }),
    })
    const result = await res.json()
    setRunning(false)
    setRunDone(true)
    if (res.ok) {
      setRunSummary(`DONE: ${result.upserted} products, ${result.errors} errors. +${result.diff?.added ?? 0} new, ${result.diff?.priceChanges?.length ?? 0} price changes`)
    } else {
      setRunSummary(`ERROR: ${result.error}`)
    }
  }

  async function handleDryRun() {
    if (!url) return
    setDryLoading(true)
    setDryError('')
    setDryProducts(null)

    const res = await fetch('/api/admin/scraper/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await res.json()
    setDryLoading(false)
    if (!res.ok) { setDryError(data.error); return }
    setDryProducts(data.products)
  }

  function handleRun() {
    if (!businessId) return
    setLogLines([])
    setRunning(true)
    setRunDone(false)
    setRunSummary('')
    setProgress({ percent: 2, step: 'Starting...', totalProducts: 0, doneProducts: 0, startedAt: Date.now() })

    if (esRef.current) esRef.current.close()
    const es = new EventSource(`/api/admin/scraper/run-stream?businessId=${businessId}`)
    esRef.current = es

    es.onmessage = e => {
      const msg: string = JSON.parse(e.data)
      if (msg.startsWith('DONE:') || msg === 'CANCELLED' || msg.startsWith('ERROR:')) {
        setProgress(prev => ({ ...prev, percent: 100, step: msg.startsWith('DONE:') ? 'Complete' : msg }))
        setRunSummary(msg)
        setRunDone(true)
        setRunning(false)
        es.close()
      } else {
        setProgress(prev => parseLogMsg(msg, prev))
        setLogLines(prev => [...prev, msg])
      }
    }
    es.onerror = () => {
      setRunning(false)
      setRunDone(true)
      setRunSummary('Stream disconnected')
      es.close()
    }
  }

  return (
    <AdminLayout title="Add Scraper">
      <div style={s.header}>
        <h1 style={s.h1}>{business ? `Scraper: ${business.name}` : 'Add Scraper'}</h1>
      </div>

      {/* Step 1: URL + Notes */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>1. URL + Notes</h2>

        {businesses.length > 0 && !business && (
          <div style={s.field}>
            <label style={s.label}>Link to existing company (optional)</label>
            <select value={businessId} onChange={e => setBusinessId(e.target.value)} style={s.select}>
              <option value="">— New company —</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div style={s.field}>
          <label style={s.label}>Shop URL *</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example-shop.com/collections/all"
            style={s.input}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Scraping notes (optional — guides Claude)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. 'Products are in .product-card containers. Skip sale items.'"
            style={{ ...s.input, height: 72, resize: 'vertical' }}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Scrape mode</label>
          <div style={{ display: 'flex', gap: 20 }}>
            {(['company', 'products'] as const).map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="radio" value={m} checked={scrapeMode === m} onChange={() => setScrapeMode(m)} />
                {m === 'company' ? 'Company — auto-discover all products' : 'Products — specific URLs'}
              </label>
            ))}
          </div>
        </div>

        {scrapeMode === 'products' && (
          <div style={s.field}>
            <label style={s.label}>Product URLs (one per line)</label>
            <textarea
              value={productUrlsText}
              onChange={e => setProductUrlsText(e.target.value)}
              placeholder="https://shop.com/products/item-1&#10;https://shop.com/products/item-2"
              style={{ ...s.input, height: 96, resize: 'vertical' }}
            />
          </div>
        )}

        <button onClick={handleGenerate} disabled={!url || genLoading} style={s.primaryBtn}>
          {genLoading
            ? 'Working...'
            : businessId
              ? `Add & Scrape (${scrapeMode})`
              : 'Generate Config'}
        </button>
        {genError && <div style={s.error}>{genError}</div>}
      </div>

      {/* Step 2: Generated Config */}
      {Object.keys(selectors).length > 0 && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>2. Generated Config</h2>
          <div style={s.configGrid}>
            {Object.entries(selectors).map(([k, v]) => (
              <div key={k} style={s.configRow}>
                <span style={s.configKey}>{k}</span>
                <code style={s.configVal}>{v}</code>
              </div>
            ))}
          </div>
          <button onClick={handleDryRun} disabled={!url || dryLoading} style={{ ...s.secondaryBtn, marginTop: 12 }}>
            {dryLoading ? 'Running preview...' : 'Dry Run Preview'}
          </button>
          {dryError && <div style={s.error}>{dryError}</div>}
        </div>
      )}

      {/* Step 3: Dry Run Results */}
      {dryProducts !== null && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>
            3. Preview — {dryProducts.length} products found
          </h2>
          {dryProducts.length === 0 ? (
            <div style={s.empty}>No products found. Adjust notes or check selectors above.</div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {['Name', 'Price', 'URL'].map(h => <th key={h} style={s.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {dryProducts.slice(0, 20).map((p, i) => (
                    <tr key={i}>
                      <td style={s.td}>{p.name}</td>
                      <td style={s.td}>${p.price.toFixed(2)}</td>
                      <td style={s.td}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', fontSize: 12 }}>
                          Link
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dryProducts.length > 20 && (
                <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>
                  Showing 20 of {dryProducts.length}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrape log — auto-shown when scrape triggers */}
      {businessId && (logLines.length > 0 || running || runDone) && (
        <div style={s.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ ...s.sectionTitle, marginBottom: 0 }}>Scrape Log</h2>
            {!running && (
              <button onClick={handleRun} style={{ ...s.secondaryBtn, fontSize: 12 }}>
                Re-run (company)
              </button>
            )}
          </div>

          {(running || runDone) && (
            <div style={s.progressWrap}>
              <div style={s.progressHeader}>
                <span style={s.progressStep}>{progress.step}</span>
                <span style={s.progressRight}>
                  {getTimeEst(progress) && <span style={s.progressTime}>{getTimeEst(progress)}</span>}
                  <span style={s.progressPct}>{progress.percent}%</span>
                </span>
              </div>
              <div style={s.progressTrack}>
                <div style={{ ...s.progressFill, width: `${progress.percent}%` }} />
              </div>
            </div>
          )}

          <div ref={logRef} style={s.logPanel}>
            {logLines.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('ERROR') ? '#ef4444' : line.startsWith('+') ? '#22c55e' : line.startsWith('~') ? '#f59e0b' : '#d1fae5' }}>
                {line}
              </div>
            ))}
            {running && <div style={{ color: '#9ca3af' }}>▌</div>}
          </div>

          {runDone && runSummary && (
            <div style={{ ...s.diffCard, marginTop: 12 }}>
              {runSummary}
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult

  const db = getAdminClient()
  const { businessId } = ctx.query

  const { data: businesses } = await db
    .from('businesses')
    .select('id, name')
    .order('name')

  if (businessId && typeof businessId === 'string') {
    const { data: business } = await db
      .from('businesses')
      .select('id, name, url, selectors, scrape_notes')
      .eq('id', businessId)
      .single()
    return { props: { business: business ?? null, businesses: businesses ?? [] } }
  }

  return { props: { businesses: businesses ?? [] } }
}

const s: Record<string, React.CSSProperties> = {
  header: { marginBottom: 28 },
  h1: { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, color: '#111', margin: 0 },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '24px 28px', marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16, marginTop: 0 },
  field: { marginBottom: 14 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  primaryBtn: { padding: '9px 20px', background: '#015237', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '8px 18px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  error: { marginTop: 8, padding: '8px 12px', background: '#fee2e2', borderRadius: 6, fontSize: 13, color: '#991b1b' },
  configGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  configRow: { display: 'flex', alignItems: 'baseline', gap: 12 },
  configKey: { fontSize: 12, fontWeight: 600, color: '#6b7280', width: 160, flexShrink: 0 },
  configVal: { fontSize: 12, background: '#f3f4f6', padding: '2px 8px', borderRadius: 4, color: '#111' },
  tableWrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '2px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 12 },
  td: { padding: '7px 10px', borderBottom: '1px solid #f3f4f6', color: '#374151' },
  empty: { color: '#9ca3af', fontSize: 14, padding: '16px 0' },
  logPanel: { background: '#111827', borderRadius: 8, padding: '14px 16px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, maxHeight: 300, overflowY: 'auto' as const, marginTop: 12 },
  diffCard: { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#166534', fontWeight: 500 },
  progressWrap: { marginBottom: 4 },
  progressHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  progressStep: { fontSize: 13, color: '#374151', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '60%' },
  progressRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  progressTime: { fontSize: 12, color: '#6b7280' },
  progressPct: { fontSize: 12, color: '#9ca3af' },
  progressTrack: { height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#015237', borderRadius: 3, transition: 'width 0.5s ease' },
}
