import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'
import type { ScrapeStatus } from '../../../lib/types'

interface Category { id: string; name: string }
interface Company {
  id: string
  name: string
  url: string
  town: string
  status: string
  verification_status: string
  category_id: string | null
  category?: { name: string }
  product_count: number
  updated_at: string
  last_scraped: string | null
  scrape_status: ScrapeStatus
}

interface Props {
  companies: Company[]
  categories: Category[]
  towns: string[]
}

const STATUS_COLORS: Record<string, string> = {
  active: '#dcfce7',
  deactivated: '#fee2e2',
}
const STATUS_TEXT_COLORS: Record<string, string> = {
  active: '#166534',
  deactivated: '#991b1b',
}
const VERIF_COLORS: Record<string, string> = {
  pending_review: '#fef3c7',
  verified: '#dcfce7',
  rejected: '#fee2e2',
  needs_info: '#dbeafe',
}
const VERIF_TEXT_COLORS: Record<string, string> = {
  pending_review: '#92400e',
  verified: '#166534',
  rejected: '#991b1b',
  needs_info: '#1e40af',
}
const VERIF_LABELS: Record<string, string> = {
  pending_review: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
  needs_info: 'Needs Info',
}

export default function CompaniesIndex({ companies, categories, towns }: Props) {
  const [search, setSearch] = useState('')
  const [filterTown, setFilterTown] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [scrapingIds, setScrapingIds] = useState<Set<string>>(new Set())

  async function runScrape(id: string) {
    setScrapingIds(prev => new Set([...prev, id]))
    await fetch('/api/admin/scraper/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: id }),
    })
    setScrapingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const filtered = companies.filter(c => {
    if (filterTown && c.town !== filterTown) return false
    if (filterCategory && c.category_id !== filterCategory) return false
    if (filterStatus && c.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.town.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <AdminLayout title="Companies">
      <div style={styles.header}>
        <h1 style={styles.h1}>Companies</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/admin/companies/import" style={styles.importBtn}>Import CSV</Link>
          <Link href="/admin/companies/new" style={styles.addBtn}>+ Add Company</Link>
        </div>
      </div>

      <div style={styles.filters}>
        <input
          placeholder="Search by name or town…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        <select value={filterTown} onChange={e => setFilterTown(e.target.value)} style={styles.select}>
          <option value="">All towns</option>
          {towns.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={styles.select}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={styles.select}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          {companies.length === 0
            ? 'No companies yet. Add your first company to get started.'
            : 'No companies match your filters.'}
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name', 'Town', 'Category', 'Status', 'Verification', 'Products', 'Last Scraped', 'Updated', ''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={styles.tr}>
                  <td style={styles.td}>
                    <Link href={`/admin/companies/${c.id}`} style={styles.nameLink}>{c.name}</Link>
                  </td>
                  <td style={styles.td}>{c.town}</td>
                  <td style={styles.td}>{c.category?.name ?? '—'}</td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.badge,
                      background: STATUS_COLORS[c.status] ?? '#f3f4f6',
                      color: STATUS_TEXT_COLORS[c.status] ?? '#374151',
                    }}>{c.status}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.badge,
                      background: VERIF_COLORS[c.verification_status] ?? '#f3f4f6',
                      color: VERIF_TEXT_COLORS[c.verification_status] ?? '#374151',
                    }}>{VERIF_LABELS[c.verification_status] ?? c.verification_status}</span>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{c.product_count}</td>
                  <td style={styles.td}>
                    {c.last_scraped ? new Date(c.last_scraped).toLocaleDateString() : <span style={{ color: '#d1d5db' }}>Never</span>}
                  </td>
                  <td style={styles.td}>{new Date(c.updated_at).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={() => runScrape(c.id)}
                      disabled={scrapingIds.has(c.id) || c.scrape_status === 'running'}
                      style={{ ...styles.scrapeBtn, opacity: scrapingIds.has(c.id) ? 0.6 : 1 }}
                    >
                      {scrapingIds.has(c.id) ? '…' : 'Scrape'}
                    </button>
                    <Link href={`/admin/companies/${c.id}/edit`} style={styles.editLink}>Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult

  const db = getAdminClient()
  const [{ data: businesses }, { data: categories }] = await Promise.all([
    db.from('businesses')
      .select('id, name, url, town, status, verification_status, category_id, updated_at, last_scraped, scrape_status, categories(name)')
      .order('updated_at', { ascending: false }),
    db.from('categories').select('id, name').order('name'),
  ])

  // Fetch product counts per business
  const { data: productCounts } = await db
    .from('products')
    .select('business_id')
    .eq('status', 'active')

  const countMap: Record<string, number> = {}
  ;(productCounts ?? []).forEach(p => {
    countMap[p.business_id] = (countMap[p.business_id] ?? 0) + 1
  })

  const companies = (businesses ?? []).map(({ categories, ...b }) => ({
    ...b,
    category: Array.isArray(categories) ? categories[0] ?? null : categories ?? null,
    product_count: countMap[b.id] ?? 0,
    updated_at: b.updated_at ?? new Date().toISOString(),
    status: b.status ?? 'active',
    verification_status: b.verification_status ?? 'pending_review',
    last_scraped: b.last_scraped ?? null,
    scrape_status: (b.scrape_status ?? 'never') as ScrapeStatus,
  }))

  const towns = [...new Set(companies.map(c => c.town))].sort()

  return {
    props: {
      companies,
      categories: categories ?? [],
      towns,
    },
  }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 },
  importBtn: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 500 },
  addBtn: {
    padding: '9px 18px',
    background: '#015237',
    color: '#fff',
    borderRadius: 8,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  },
  filters: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  searchInput: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    flex: '1 1 200px',
    minWidth: 180,
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    minWidth: 130,
  },
  tableWrap: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '13px 16px', fontSize: 14, color: '#374151', verticalAlign: 'middle' },
  nameLink: { color: '#015237', fontWeight: 600, textDecoration: 'none' },
  badge: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  editLink: { color: '#6b7280', fontSize: 13, textDecoration: 'none' },
  scrapeBtn: { fontSize: 12, padding: '3px 10px', background: '#015237', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 500 },
  empty: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    padding: '48px',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 15,
  },
}
