import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

interface Product {
  id: string; name: string; price: number; availability: string; status: string
  url: string | null; updated_at: string
  business?: { id: string; name: string } | null
  category?: { name: string } | null
}

interface Company { id: string; name: string }
interface Category { id: string; name: string }
interface Props { products: Product[]; companies: Company[]; categories: Category[] }

const AVAIL_COLORS: Record<string, { bg: string; text: string }> = {
  in_stock: { bg: '#dcfce7', text: '#166534' },
  out_of_stock: { bg: '#fee2e2', text: '#991b1b' },
  limited: { bg: '#fef3c7', text: '#92400e' },
  unknown: { bg: '#f3f4f6', text: '#6b7280' },
}
const AVAIL_LABELS: Record<string, string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', limited: 'Limited', unknown: 'Unknown'
}

export default function ProductsIndex({ products, companies, categories }: Props) {
  const [search, setSearch] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterAvail, setFilterAvail] = useState('')

  const filtered = products.filter(p => {
    if (filterCompany && p.business?.id !== filterCompany) return false
    if (filterAvail && p.availability !== filterAvail) return false
    if (search) {
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || (p.business?.name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <AdminLayout title="Products">
      <div style={styles.header}>
        <h1 style={styles.h1}>Products</h1>
        <div style={{ display: 'flex', gap: 10 }}>
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
                return (
                  <tr key={p.id} style={styles.tr}>
                    <td style={styles.td}><Link href={`/admin/products/${p.id}`} style={styles.nameLink}>{p.name}</Link></td>
                    <td style={styles.td}>{p.business ? <Link href={`/admin/companies/${p.business.id}`} style={{ color: '#6b7280', textDecoration: 'none' }}>{p.business.name}</Link> : '—'}</td>
                    <td style={styles.td}>${Number(p.price).toFixed(2)}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: avail.bg, color: avail.text }}>
                        {AVAIL_LABELS[p.availability] ?? p.availability}
                      </span>
                    </td>
                    <td style={styles.td}>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', fontSize: 12 }}>Link</a> : '—'}</td>
                    <td style={styles.td}>{new Date(p.updated_at).toLocaleDateString()}</td>
                    <td style={styles.td}><Link href={`/admin/products/${p.id}/edit`} style={styles.editLink}>Edit</Link></td>
                  </tr>
                )
              })}
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
  const [{ data: products }, { data: companies }, { data: categories }] = await Promise.all([
    db.from('products')
      .select('id, name, price, availability, status, url, updated_at, businesses(id, name), categories(name)')
      .order('updated_at', { ascending: false })
      .limit(500),
    db.from('businesses').select('id, name').eq('status', 'active').order('name'),
    db.from('categories').select('id, name').order('name'),
  ])
  const mapped = (products ?? []).map(p => ({
    ...p,
    business: Array.isArray(p.businesses) ? p.businesses[0] ?? null : p.businesses ?? null,
    businesses: undefined,
    category: Array.isArray(p.categories) ? p.categories[0] ?? null : p.categories ?? null,
    categories: undefined,
    updated_at: p.updated_at ?? new Date().toISOString(),
    availability: p.availability ?? 'unknown',
    status: p.status ?? 'active',
  }))
  return { props: { products: mapped, companies: companies ?? [], categories: categories ?? [] } }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 },
  addBtn: { padding: '9px 18px', background: '#015237', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  importBtn: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 500 },
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
  empty: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '48px', textAlign: 'center', color: '#9ca3af', fontSize: 15 },
}
