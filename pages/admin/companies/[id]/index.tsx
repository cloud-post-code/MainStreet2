import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState } from 'react'
import AdminLayout from '../../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../../lib/admin/auth'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

interface Product {
  id: string; name: string; price: number; availability: string; status: string; updated_at: string
}
interface Company {
  id: string; name: string; url: string; town: string; status: string; verification_status: string
  contact_name: string | null; contact_email: string | null; contact_phone: string | null
  address_street: string | null; address_city: string | null; address_state: string | null; address_zip: string | null
  last_scraped: string | null; scrape_status: string
  category?: { name: string } | null
  products: Product[]
}

const VERIF_COLORS: Record<string, { bg: string; text: string }> = {
  pending_review: { bg: '#fef3c7', text: '#92400e' },
  verified: { bg: '#dcfce7', text: '#166534' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
  needs_info: { bg: '#dbeafe', text: '#1e40af' },
}
const VERIF_LABELS: Record<string, string> = {
  pending_review: 'Pending', verified: 'Verified', rejected: 'Rejected', needs_info: 'Needs Info',
}

interface Props { company: Company }

const AVAIL_LABELS: Record<string, string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', limited: 'Limited', unknown: 'Unknown'
}
const AVAIL_COLORS: Record<string, { bg: string; text: string }> = {
  in_stock: { bg: '#dcfce7', text: '#166534' },
  out_of_stock: { bg: '#fee2e2', text: '#991b1b' },
  limited: { bg: '#fef3c7', text: '#92400e' },
  unknown: { bg: '#f3f4f6', text: '#6b7280' },
}

export default function CompanyDetail({ company }: Props) {
  const [deactivating, setDeactivating] = useState(false)

  async function handleDeactivate() {
    if (!confirm(`Deactivate "${company.name}"? All associated products will also be deactivated.`)) return
    setDeactivating(true)
    await fetch(`/api/admin/companies/${company.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deactivated' }),
    })
    window.location.reload()
  }

  const isDeactivated = company.status === 'deactivated'

  return (
    <AdminLayout title={company.name}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/companies" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>← Companies</Link>
      </div>

      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>{company.name}</h1>
          <a href={company.url} target="_blank" rel="noopener noreferrer" style={styles.url}>{company.url}</a>
        </div>
        <div style={styles.headerActions}>
          <Link href={`/admin/companies/${company.id}/edit`} style={styles.editBtn}>Edit</Link>
          {!isDeactivated && (
            <button onClick={handleDeactivate} disabled={deactivating} style={styles.deactivateBtn}>
              {deactivating ? 'Deactivating…' : 'Deactivate'}
            </button>
          )}
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Details</h2>
          <dl style={styles.dl}>
            <dt style={styles.dt}>Town</dt><dd style={styles.dd}>{company.town}</dd>
            <dt style={styles.dt}>Category</dt><dd style={styles.dd}>{company.category?.name ?? '—'}</dd>
            <dt style={styles.dt}>Status</dt>
            <dd style={styles.dd}>
              <span style={{ ...styles.badge, background: isDeactivated ? '#fee2e2' : '#dcfce7', color: isDeactivated ? '#991b1b' : '#166534' }}>
                {company.status}
              </span>
            </dd>
            <dt style={styles.dt}>Verification</dt>
            <dd style={styles.dd}>
              {(() => {
                const vc = VERIF_COLORS[company.verification_status] ?? { bg: '#f3f4f6', text: '#6b7280' }
                return <span style={{ ...styles.badge, background: vc.bg, color: vc.text }}>{VERIF_LABELS[company.verification_status] ?? company.verification_status}</span>
              })()}
            </dd>
            <dt style={styles.dt}>Last Scraped</dt>
            <dd style={styles.dd}>
              {company.last_scraped
                ? new Date(company.last_scraped).toLocaleDateString()
                : <span style={{ color: '#d1d5db' }}>Never</span>}
              {' '}
              <Link href={`/admin/scraper/new?businessId=${company.id}`} style={{ fontSize: 12, color: '#015237' }}>
                {company.last_scraped ? 'Re-scrape' : 'Scrape now'}
              </Link>
            </dd>
          </dl>
        </div>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Contact</h2>
          <dl style={styles.dl}>
            <dt style={styles.dt}>Name</dt><dd style={styles.dd}>{company.contact_name ?? '—'}</dd>
            <dt style={styles.dt}>Email</dt><dd style={styles.dd}>{company.contact_email ?? '—'}</dd>
            <dt style={styles.dt}>Phone</dt><dd style={styles.dd}>{company.contact_phone ?? '—'}</dd>
            <dt style={styles.dt}>Address</dt>
            <dd style={styles.dd}>
              {[company.address_street, company.address_city, company.address_state, company.address_zip].filter(Boolean).join(', ') || '—'}
            </dd>
          </dl>
        </div>
      </div>

      <div style={styles.productsSection}>
        <div style={styles.productsHeader}>
          <h2 style={styles.h2}>Products ({company.products.length})</h2>
          <Link href={`/admin/products/new?company=${company.id}`} style={styles.addProductBtn}>+ Add Product</Link>
        </div>
        {company.products.length === 0 ? (
          <div style={styles.empty}>No products yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Name', 'Price', 'Availability', 'Status', 'Updated', ''].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {company.products.map(p => {
                  const avail = AVAIL_COLORS[p.availability] ?? { bg: '#f3f4f6', text: '#6b7280' }
                  return (
                    <tr key={p.id} style={styles.tr}>
                      <td style={styles.td}><Link href={`/admin/products/${p.id}`} style={styles.nameLink}>{p.name}</Link></td>
                      <td style={styles.td}>${Number(p.price).toFixed(2)}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: avail.bg, color: avail.text }}>
                          {AVAIL_LABELS[p.availability] ?? p.availability}
                        </span>
                      </td>
                      <td style={styles.td}>{p.status}</td>
                      <td style={styles.td}>{new Date(p.updated_at).toLocaleDateString()}</td>
                      <td style={styles.td}><Link href={`/admin/products/${p.id}/edit`} style={styles.editLink}>Edit</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const { id } = ctx.params as { id: string }
  const db = getAdminClient()
  const { data: company, error } = await db
    .from('businesses')
    .select('*, categories(name), products(id, name, price, availability, status, updated_at)')
    .eq('id', id)
    .single()
  if (error || !company) return { notFound: true }
  const { categories, ...rest } = company
  return {
    props: {
      company: {
        ...rest,
        category: Array.isArray(categories) ? categories[0] ?? null : categories ?? null,
        products: rest.products ?? [],
      },
    },
  }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  h1: { fontSize: 26, fontWeight: 700, color: '#111827', margin: '0 0 4px' },
  h2: { fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 },
  url: { color: '#6b7280', fontSize: 13, textDecoration: 'none' },
  headerActions: { display: 'flex', gap: 10 },
  editBtn: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none', color: '#374151' },
  deactivateBtn: { padding: '9px 18px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 14, fontWeight: 500, color: '#dc2626', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#374151', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  dl: { display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px 16px', margin: 0 },
  dt: { fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 2 },
  dd: { fontSize: 14, color: '#374151', margin: 0 },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  productsSection: {},
  productsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  addProductBtn: { padding: '8px 16px', background: '#015237', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 600 },
  tableWrap: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '11px 16px', fontSize: 11, fontWeight: 600, color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textTransform: 'uppercase', letterSpacing: '0.05em' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '12px 16px', fontSize: 14, color: '#374151', verticalAlign: 'middle' },
  nameLink: { color: '#015237', fontWeight: 600, textDecoration: 'none' },
  editLink: { color: '#6b7280', fontSize: 13, textDecoration: 'none' },
  empty: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '32px', textAlign: 'center', color: '#9ca3af' },
}
