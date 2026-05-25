import { GetServerSideProps } from 'next'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'
import type { RawProduct } from '../../../lib/scraper'

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

  const [logLines, setLogLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runDone, setRunDone] = useState(false)
  const [runSummary, setRunSummary] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

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

    if (esRef.current) esRef.current.close()
    const es = new EventSource(`/api/admin/scraper/run-stream?businessId=${businessId}`)
    esRef.current = es

    es.onmessage = e => {
      const msg: string = JSON.parse(e.data)
      if (msg.startsWith('DONE:') || msg === 'CANCELLED' || msg.startsWith('ERROR:')) {
        setRunSummary(msg)
        setRunDone(true)
        setRunning(false)
        es.close()
      } else {
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

        <button onClick={handleGenerate} disabled={!url || genLoading} style={s.primaryBtn}>
          {genLoading ? 'Generating config...' : 'Generate Config'}
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

      {/* Step 4: Run */}
      {businessId && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>4. Run Scrape</h2>
          <button onClick={handleRun} disabled={running || !businessId} style={s.primaryBtn}>
            {running ? 'Scraping...' : 'Run Full Scrape'}
          </button>

          {(logLines.length > 0 || running || runDone) && (
            <div ref={logRef} style={s.logPanel}>
              {logLines.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('ERROR') ? '#ef4444' : line.startsWith('+') ? '#22c55e' : line.startsWith('~') ? '#f59e0b' : '#d1fae5' }}>
                  {line}
                </div>
              ))}
              {running && <div style={{ color: '#9ca3af' }}>▌</div>}
            </div>
          )}

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
}
