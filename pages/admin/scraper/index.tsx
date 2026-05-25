import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'
import { STALE_THRESHOLD_DAYS } from '../../../lib/scraper'
import type { ScrapeDiff, ScrapeStatus } from '../../../lib/types'

interface Business {
  id: string
  name: string
  url: string
  town: string
  scrape_status: ScrapeStatus
  last_scraped: string | null
  last_scrape_diff: ScrapeDiff | null
}

interface Props {
  businesses: Business[]
  staleCount: number
}

function scrapeHealth(b: Business): 'green' | 'yellow' | 'red' {
  if (!b.last_scraped) return 'red'
  const days = (Date.now() - new Date(b.last_scraped).getTime()) / 86400000
  if (days <= STALE_THRESHOLD_DAYS) return 'green'
  if (days <= 30) return 'yellow'
  return 'red'
}

const HEALTH_COLORS = {
  green: { bg: '#dcfce7', border: '#86efac', text: '#166534', dot: '#22c55e' },
  yellow: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e', dot: '#f59e0b' },
  red: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', dot: '#ef4444' },
}

export default function ScraperIndex({ businesses: initial, staleCount }: Props) {
  const [businesses, setBusinesses] = useState(initial)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  const [runningIds, setRunningIds] = useState<Set<string>>(
    new Set(initial.filter(b => b.scrape_status === 'running').map(b => b.id))
  )

  // Poll status for running businesses
  useEffect(() => {
    if (runningIds.size === 0) return
    const timer = setInterval(async () => {
      const res = await fetch('/api/admin/scraper/status?all=true')
      if (!res.ok) return
      const { businesses: updated } = await res.json()
      setBusinesses(updated)
      const stillRunning = new Set<string>(
        updated.filter((b: Business) => b.scrape_status === 'running').map((b: Business) => b.id)
      )
      setRunningIds(stillRunning)
    }, 3000)
    return () => clearInterval(timer)
  }, [runningIds])

  async function runSingle(id: string) {
    setRunningIds(prev => new Set([...prev, id]))
    await fetch('/api/admin/scraper/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: id }),
    })
  }

  async function runBulk() {
    setBulkRunning(true)
    setBulkMsg('')
    const res = await fetch('/api/admin/scraper/run-bulk', { method: 'POST' })
    const data = await res.json()
    setBulkMsg(data.queued > 0 ? `Queued ${data.queued} businesses...` : 'No stale businesses to scrape')
    if (data.queued > 0) {
      const ids = businesses.filter(b => scrapeHealth(b) !== 'green').map(b => b.id)
      setRunningIds(new Set(ids))
    }
    setBulkRunning(false)
  }

  const green = businesses.filter(b => scrapeHealth(b) === 'green')
  const yellow = businesses.filter(b => scrapeHealth(b) === 'yellow')
  const red = businesses.filter(b => scrapeHealth(b) === 'red')

  return (
    <AdminLayout title="Scraper">
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Scraper</h1>
          <p style={s.sub}>
            {green.length} fresh · {yellow.length} stale · {red.length} never scraped
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {staleCount > 0 && (
            <button onClick={runBulk} disabled={bulkRunning} style={s.bulkBtn}>
              {bulkRunning ? 'Queueing...' : `Refresh Stale (${staleCount})`}
            </button>
          )}
          <Link href="/admin/scraper/new" style={s.addBtn}>+ Add URL</Link>
        </div>
      </div>

      {bulkMsg && <div style={s.bulkMsg}>{bulkMsg}</div>}

      {businesses.length === 0 ? (
        <div style={s.empty}>
          No businesses yet. <Link href="/admin/companies/new" style={{ color: '#015237' }}>Add one</Link> to get started.
        </div>
      ) : (
        <>
          {[
            { label: 'Never scraped / Stale (30d+)', items: red, color: 'red' as const },
            { label: `Stale (${STALE_THRESHOLD_DAYS}–30 days)`, items: yellow, color: 'yellow' as const },
            { label: 'Fresh (last 7 days)', items: green, color: 'green' as const },
          ].map(({ label, items, color }) => items.length > 0 && (
            <div key={color} style={{ marginBottom: 32 }}>
              <h2 style={s.sectionLabel}>{label} ({items.length})</h2>
              <div style={s.grid}>
                {items.map(b => {
                  const h = HEALTH_COLORS[color]
                  const isRunning = runningIds.has(b.id) || b.scrape_status === 'running'
                  return (
                    <div key={b.id} style={{ ...s.card, background: h.bg, borderColor: h.border }}>
                      <div style={s.cardTop}>
                        <span style={{ ...s.dot, background: h.dot }} />
                        <span style={{ ...s.cardName, color: h.text }}>{b.name}</span>
                      </div>
                      <div style={s.cardTown}>{b.town}</div>
                      {b.last_scraped && (
                        <div style={s.cardMeta}>
                          Last: {new Date(b.last_scraped).toLocaleDateString()}
                          {b.last_scrape_diff && (
                            <span style={s.diffBadge}>
                              +{b.last_scrape_diff.added} / ~{b.last_scrape_diff.priceChanges.length}
                            </span>
                          )}
                        </div>
                      )}
                      <div style={s.cardActions}>
                        <button
                          onClick={() => runSingle(b.id)}
                          disabled={isRunning}
                          style={{ ...s.runBtn, opacity: isRunning ? 0.6 : 1 }}
                        >
                          {isRunning ? 'Running...' : 'Scrape'}
                        </button>
                        <Link href={`/admin/scraper/new?businessId=${b.id}`} style={s.configLink}>
                          Config
                        </Link>
                        <Link href={`/admin/companies/${b.id}`} style={s.configLink}>View</Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult

  const db = getAdminClient()
  const { data } = await db
    .from('businesses')
    .select('id, name, url, town, scrape_status, last_scraped, last_scrape_diff')
    .order('name')

  const businesses = data ?? []
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - STALE_THRESHOLD_DAYS)
  const staleCount = businesses.filter(b => !b.last_scraped || new Date(b.last_scraped) < staleDate).length

  return { props: { businesses, staleCount } }
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  h1: { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, color: '#111', margin: 0 },
  sub: { fontSize: 13, color: '#6b7280', margin: '4px 0 0' },
  sectionLabel: { fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  card: { border: '1px solid', borderRadius: 10, padding: '14px 16px' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  cardName: { fontWeight: 600, fontSize: 14, lineHeight: 1.3 },
  cardTown: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  cardMeta: { fontSize: 11, color: '#9ca3af', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 },
  diffBadge: { background: 'rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 6px', fontSize: 10 },
  cardActions: { display: 'flex', gap: 6 },
  runBtn: { fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#015237', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 500 },
  configLink: { fontSize: 12, padding: '4px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.06)', color: '#374151', textDecoration: 'none', fontWeight: 500 },
  bulkBtn: { padding: '8px 16px', background: '#b45309', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  addBtn: { padding: '8px 16px', background: '#015237', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' },
  bulkMsg: { marginBottom: 16, padding: '10px 14px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e' },
  empty: { textAlign: 'center', color: '#9ca3af', padding: '60px 0', fontSize: 15 },
}
