import { GetServerSideProps } from 'next'
import Link from 'next/link'
import AdminLayout from '../../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../../lib/admin/auth'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

interface Product {
  id: string; name: string; description: string | null; price: number; image_url: string | null
  image_urls: string[]
  availability: string; status: string; url: string | null; sku: string | null
  business_id: string; updated_at: string
  business?: { id: string; name: string } | null
  category?: { name: string } | null
}

const AVAIL_LABELS: Record<string, string> = {
  in_stock: 'In Stock', out_of_stock: 'Out of Stock', limited: 'Limited', unknown: 'Unknown'
}

export default function ProductDetail({ product }: { product: Product }) {
  async function handleDeactivate() {
    if (!confirm(`Deactivate "${product.name}"?`)) return
    await fetch(`/api/admin/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deactivated' }),
    })
    window.location.reload()
  }

  return (
    <AdminLayout title={product.name}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/products" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>← Products</Link>
      </div>
      <div style={styles.header}>
        <h1 style={styles.h1}>{product.name}</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href={`/admin/products/${product.id}/edit`} style={styles.editBtn}>Edit</Link>
          {product.status === 'active' && (
            <button onClick={handleDeactivate} style={styles.deactivateBtn}>Deactivate</button>
          )}
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Details</h2>
          <dl style={styles.dl}>
            <dt style={styles.dt}>Company</dt>
            <dd style={styles.dd}>
              {product.business ? <Link href={`/admin/companies/${product.business.id}`} style={{ color: '#015237', textDecoration: 'none' }}>{product.business.name}</Link> : '—'}
            </dd>
            <dt style={styles.dt}>Category</dt><dd style={styles.dd}>{product.category?.name ?? '—'}</dd>
            <dt style={styles.dt}>Price</dt><dd style={styles.dd}>${Number(product.price).toFixed(2)}</dd>
            <dt style={styles.dt}>Availability</dt><dd style={styles.dd}>{AVAIL_LABELS[product.availability] ?? product.availability}</dd>
            <dt style={styles.dt}>Status</dt><dd style={styles.dd}>{product.status}</dd>
            <dt style={styles.dt}>SKU</dt><dd style={styles.dd}>{product.sku ?? '—'}</dd>
            <dt style={styles.dt}>Source</dt>
            <dd style={styles.dd}>
              {product.url ? <a href={product.url} target="_blank" rel="noopener noreferrer" style={{ color: '#015237' }}>View source</a> : '—'}
            </dd>
            <dt style={styles.dt}>Updated</dt><dd style={styles.dd}>{new Date(product.updated_at).toLocaleString()}</dd>
          </dl>
        </div>
        {product.image_urls.length > 0 && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Images ({product.image_urls.length})</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {product.image_urls.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={url} alt={`${product.name} ${i + 1}`} style={{ width: 100, height: 100, objectFit: 'contain', borderRadius: 6, border: i === 0 ? '2px solid #015237' : '1px solid #e5e7eb' }} />
                  {i === 0 && <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, background: '#015237', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>PRIMARY</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {product.description && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Description</h2>
          <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, margin: 0 }}>{product.description}</p>
        </div>
      )}
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const { id } = ctx.params as { id: string }
  const db = getAdminClient()
  const [{ data: product, error }, { data: images }] = await Promise.all([
    db.from('products').select('*, businesses(id, name), categories(name)').eq('id', id).single(),
    db.from('product_images').select('image_url').eq('product_id', id).order('display_order'),
  ])
  if (error || !product) return { notFound: true }
  const imageUrls: string[] = images?.length
    ? images.map((i: { image_url: string }) => i.image_url)
    : product.image_url ? [product.image_url] : []
  return {
    props: {
      product: {
        ...product,
        image_urls: imageUrls,
        business: Array.isArray(product.businesses) ? product.businesses[0] ?? null : product.businesses ?? null,
        businesses: undefined,
        category: Array.isArray(product.categories) ? product.categories[0] ?? null : product.categories ?? null,
        categories: undefined,
        updated_at: product.updated_at ?? new Date().toISOString(),
      },
    },
  }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  h1: { fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 },
  editBtn: { padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none', color: '#374151' },
  deactivateBtn: { padding: '9px 18px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 14, fontWeight: 500, color: '#dc2626', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 20 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: '#9ca3af', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  dl: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 16px', margin: 0 },
  dt: { fontSize: 12, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 2 },
  dd: { fontSize: 14, color: '#374151', margin: 0 },
}
