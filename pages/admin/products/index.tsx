import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

const PAGE_SIZE = 50

interface Product {
  id: string; name: string; price: number; availability: string; status: string
  url: string | null; updated_at: string
  business?: { id: string; name: string } | null
  category?: { name: string } | null
}

interface Company { id: string; name: string }
interface Category { id: string; name: string }
interface Props {
  products: Product[]
  companies: Company[]
  categories: Category[]
  total: number
  page: number
}

const AVAIL_COLORS: Record<string, { bg: string; text: string }> = {
  in_stock: { bg: '#dcfce7', text: '#166534' },
  out_of_stock: { bg: '#fee2e2', text: '#991b1b' },
  limited: { bg: '#fef3c7', text: '#92400e' },
  unknown: { bg: '#f3f4f6', text: '#6b7280' },
}
const AVAIL_LABELS: Record<string, string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', limited: 'Limited', unknown: 'Unknown'
}
const AVAIL_OPTIONS = ['in_stock', 'out_of_stock', 'limited', 'unknown']

function exportCsv(products: Product[]) {
  const header = ['Name', 'Company', 'Price', 'Availability', 'Status', 'URL', 'Updated']
  const rows = products.map(p => [
    p.name,
    p.business?.name ?? '',
    p.price.toFixed(2),
    p.availability,
    p.status,
    p.url ?? '',
    new Date(p.updated_at).toLocaleDateString(),
  ])
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

export default function ProductsIndex({ products, companies, categories, total, page }: Props) {
  const [search, setSearch] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterAvail, setFilterAvail] = useState('')

  // Inline edit state: { [productId]: { price?: string, availability?: string } }
  const [editing, setEditing] = useState<Record<string, Partial<Product>>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())

  const filtered = products.filter(p => {
    if (filterCompany && p.business?.id !== filterCompany) return false
    if (filterAvail && p.availability !== filterAvail) return false
    if (search) {
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || (p.business?.name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  function startEdit(id: string, field: 'price' | 'availability', value: string | number) {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [field]: String(value) } }))
  }

  async function saveField(p: Product, field: 'price' | 'availability', value: string) {
    setSaving(prev => new Set([...prev, p.id]))
    const body: Record<string, unknown> = {}
    if (field === 'price') body.price = parseFloat(value)
    if (field === 'availability') body.availability = value

    await fetch(`/api/admin/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    // Lock the field so future scrapes don't overwrite
    await fetch(`/api/admin/products/${p.id}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_name: field }),
    })

    setEditing(prev => {
      const n = { ...prev }
      if (n[p.id]) { delete (n[p.id] as Record<string, unknown>)[field]; if (!Object.keys(n[p.id]).length) delete n[p.id] }
      return n
    })
    setSaving(prev => { const s = new Set(prev); s.delete(p.id); return s })
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <AdminLayout title="Products">
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Products</h1>
          <p style={styles.sub}>{total.toLocaleString()} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => exportCsv(filtered)} style={styles.csvBtn}>Export CSV</button>
          <Link href="/admin/products/import" style={styles.importBtn}>Import CSV</Link>
          <Link href="/admin/products/new" style={styles.addBtn}>+ Add Product</Link>
        </div>
      </div>

      <div style={styles.filters}>
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} style={styles.select}>
          <option value="">All companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterAvail} onChange={e => setFilterAvail(e.target.value)} style={styles.select}>
          <option value="">All availability</option>
          <option value="in_stock">In Stock</option>
          <option value="out_of_stock">Out of Stock</option>
          <option value="limited">Limited</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          {products.length === 0 ? 'No products yet.' : 'No products match your filters.'}
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name', 'Company', 'Price', 'Availability', 'Source', 'Updated', ''].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const avail = AVAIL_COLORS[p.availability] ?? { bg: '#f3f4f6', text: '#6b7280' }
                const editP = editing[p.id] ?? {}
                const isSaving = saving.has(p.id)

                const priceEditing = 'price' in editP
                const availEditing = 'availability' in editP

                return (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}>
                      <Link href={`/admin/products/${p.id}`} style={styles.nameLink}>{p.name}</Link>
                    </td>
                    <td style={styles.td}>
                      {p.business
                        ? <Link href={`/admin/companies/${p.business.id}`} style={{ color: '#6b7280', textDecoration: 'none' }}>{p.business.name}</Link>
                        : '—'}
                    </td>

                    {/* Inline price edit */}
                    <td style={styles.td}>
                      {priceEditing ? (
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          defaultValue={String(p.price)}
                          style={styles.inlineInput}
                          disabled={isSaving}
                          onBlur={e => saveField(p, 'price', e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveField(p, 'price', (e.target as HTMLInputElement).value)}
                        />
                      ) : (
                        <span
                          onClick={() => startEdit(p.id, 'price', p.price)}
                          title="Click to edit"
                          style={styles.editableCell}
                        >
                          ${Number(p.price).toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Inline availability edit */}
                    <td style={styles.td}>
                      {availEditing ? (
                        <select
                          autoFocus
                          defaultValue={p.availability}
                          style={styles.inlineSelect}
                          disabled={isSaving}
                          onBlur={e => saveField(p, 'availability', e.target.value)}
                          onChange={e => saveField(p, 'availability', e.target.value)}
                        >
                          {AVAIL_OPTIONS.map(o => <option key={o} value={o}>{AVAIL_LABELS[o]}</option>)}
                        </select>
                      ) : (
                        <span
                          onClick={() => startEdit(p.id, 'availability', p.availability)}
                          title="Click to edit"
                          style={{ ...styles.badge, background: avail.bg, color: avail.text, cursor: 'pointer' }}
                        >
                          {AVAIL_LABELS[p.availability] ?? p.availability}
                        </span>
                      )}
                    </td>

                    <td style={styles.td}>
                      {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', fontSize: 12 }}>Link</a> : '—'}
                    </td>
                    <td style={styles.td}>{new Date(p.updated_at).toLocaleDateString()}</td>
                    <td style={styles.td}>
                      <Link href={`/admin/products/${p.id}/edit`} style={styles.editLink}>Edit</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={styles.pagination}>
          {page > 1 && (
            <Link href={`/admin/products?page=${page - 1}`} style={styles.pageBtn}>← Prev</Link>
          )}
          <span style={styles.pageInfo}>Page {page} of {totalPages} ({total.toLocaleString()} products)</span>
          {page < totalPages && (
            <Link href={`/admin/products?page=${page + 1}`} style={styles.pageBtn}>Next →</Link>
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
  const page = Math.max(1, parseInt(String(ctx.query.page ?? '1')))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const [{ data: products, count }, { data: companies }, { data: categories }] = await Promise.all([
    db.from('products')
      .select('id, name, price, availability, status, url, updated_at, businesses(id, name), categories(name)', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to),
    db.from('businesses').select('id, name').eq('status', 'active').order('name'),
    db.from('categories').select('id, name').order('name'),
  ])

  const mapped = (products ?? []).map(({ businesses, categories, ...p }) => ({
    ...p,
    business: Array.isArray(businesses) ? businesses[0] ?? null : businesses ?? null,
    category: Array.isArray(categories) ? categories[0] ?? null : categories ?? null,
    updated_at: p.updated_at ?? new Date().toISOString(),
    availability: p.availability ?? 'unknown',
    status: p.status ?? 'active',
  }))

  return {
    props: {
      products: mapped,
      companies: companies ?? [],
      categories: categories ?? [],
      total: count ?? 0,
      page,
    },
  }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 },
  sub: { fontSize: 13, color: '#9ca3af', margin: '2px 0 0' },
  addBtn: { padding: '9px 18px', background: '#015237', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  importBtn: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 500 },
  csvBtn: { padding: '9px 18px', background: '#f3f4f6', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  filters: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  searchInput: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, flex: '1 1 200px', minWidth: 180 },
  select: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', minWidth: 140 },
  tableWrap: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textTransform: 'uppercase', letterSpacing: '0.05em' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '13px 16px', fontSize: 14, color: '#374151', verticalAlign: 'middle' },
  nameLink: { color: '#015237', fontWeight: 600, textDecoration: 'none' },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  editLink: { color: '#6b7280', fontSize: 13, textDecoration: 'none' },
  editableCell: { cursor: 'pointer', borderBottom: '1px dashed #d1d5db', paddingBottom: 1 },
  inlineInput: { width: 80, padding: '3px 6px', border: '1px solid #015237', borderRadius: 4, fontSize: 14 },
  inlineSelect: { padding: '3px 6px', border: '1px solid #015237', borderRadius: 4, fontSize: 13 },
  empty: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '48px', textAlign: 'center', color: '#9ca3af', fontSize: 15 },
  pagination: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 20, justifyContent: 'center' },
  pageBtn: { padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, color: '#374151', textDecoration: 'none', fontSize: 13 },
  pageInfo: { fontSize: 13, color: '#6b7280' },
}
