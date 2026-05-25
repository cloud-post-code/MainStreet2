import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'

interface Category { id: string; name: string }
interface Company { id: string; name: string }

interface ProductFormData {
  business_id: string
  name: string
  description: string
  price: string
  image_url: string
  availability: string
  category_id: string
  sku: string
  url: string
}

interface Props {
  initial?: Partial<ProductFormData>
  categories: Category[]
  companies: Company[]
  productId?: string
  lockedFields?: string[]
}

const AVAIL_OPTIONS = [
  { value: 'in_stock', label: 'In Stock' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'limited', label: 'Limited' },
  { value: 'unknown', label: 'Unknown' },
]

function LockIcon({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={locked ? 'Field locked (manual override)' : 'Click to lock this field'}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 14, color: locked ? '#015237' : '#d1d5db', padding: '2px 4px',
        flexShrink: 0,
      }}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  )
}

export default function ProductForm({ initial, categories, companies, productId, lockedFields = [] }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<ProductFormData>({
    business_id: initial?.business_id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    price: initial?.price ?? '',
    image_url: initial?.image_url ?? '',
    availability: initial?.availability ?? 'unknown',
    category_id: initial?.category_id ?? '',
    sku: initial?.sku ?? '',
    url: initial?.url ?? '',
  })
  const [locked, setLocked] = useState<Set<string>>(new Set(lockedFields))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [imageError, setImageError] = useState(false)

  function set(field: keyof ProductFormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function toggleLock(field: string) {
    setLocked(prev => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const endpoint = productId ? `/api/admin/products/${productId}` : '/api/admin/products'
    const method = productId ? 'PATCH' : 'POST'
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, locked_fields: [...locked] }),
    })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to save.')
      setSaving(false)
      return
    }
    const saved = await res.json()
    router.push(`/admin/products/${saved.id}`)
  }

  const showPreview = form.image_url && !imageError

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Basic Info</h2>
        <div style={styles.row}>
          <Field label="Company *" style={{ flex: 2 }}>
            <select value={form.business_id} onChange={e => set('business_id', e.target.value)} required style={styles.select}>
              <option value="">Select company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Category *">
            <select value={form.category_id} onChange={e => set('category_id', e.target.value)} required style={styles.select}>
              <option value="">Select category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div style={styles.row}>
          <LockedField label="Name *" locked={locked.has('name')} onToggle={() => toggleLock('name')}>
            <input value={form.name} onChange={e => set('name', e.target.value)} required style={styles.input} />
          </LockedField>
          <Field label="SKU (optional)">
            <input value={form.sku} onChange={e => set('sku', e.target.value)} style={styles.input} placeholder="Optional" />
          </Field>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Details</h2>
        <LockedField label="Description" locked={locked.has('description')} onToggle={() => toggleLock('description')}>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} style={{ ...styles.input, minHeight: 80, resize: 'vertical' }} />
        </LockedField>
        <div style={styles.row}>
          <LockedField label="Price *" locked={locked.has('price')} onToggle={() => toggleLock('price')}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={e => set('price', e.target.value)}
              required
              style={styles.input}
              placeholder="0.00"
            />
          </LockedField>
          <LockedField label="Availability" locked={locked.has('availability')} onToggle={() => toggleLock('availability')}>
            <select value={form.availability} onChange={e => set('availability', e.target.value)} style={styles.select}>
              {AVAIL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </LockedField>
        </div>
        <Field label="Source URL">
          <input type="url" value={form.url} onChange={e => set('url', e.target.value)} style={styles.input} placeholder="https://" />
        </Field>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Image</h2>
        <LockedField label="Image URL" locked={locked.has('image_url')} onToggle={() => toggleLock('image_url')}>
          <input
            type="url"
            value={form.image_url}
            onChange={e => { set('image_url', e.target.value); setImageError(false) }}
            style={styles.input}
            placeholder="https://"
          />
        </LockedField>
        {showPreview && (
          <div style={{ marginTop: 12 }}>
            <img
              src={form.image_url}
              alt="Preview"
              onError={() => setImageError(true)}
              style={{ maxHeight: 160, maxWidth: 240, borderRadius: 8, border: '1px solid #e5e7eb', objectFit: 'contain' }}
            />
          </div>
        )}
        {imageError && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#ef4444' }}>Image failed to load. URL may be invalid.</div>
        )}
      </section>

      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.actions}>
        <button type="button" onClick={() => router.back()} style={styles.cancelBtn}>Cancel</button>
        <button type="submit" disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving…' : productId ? 'Save Changes' : 'Add Product'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, marginBottom: 16, ...style }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

function LockedField({ label, children, locked, onToggle }: { label: string; children: React.ReactNode; locked: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        <LockIcon locked={locked} onClick={onToggle} />
      </div>
      {children}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 0 },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '24px 28px', marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 18px' },
  row: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  input: { padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, width: '100%', boxSizing: 'border-box', marginTop: 4 },
  select: { padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', width: '100%', boxSizing: 'border-box', marginTop: 4 },
  error: { background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#dc2626', marginBottom: 16 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12 },
  cancelBtn: { padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', color: '#374151' },
  saveBtn: { padding: '10px 24px', background: '#015237', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
}
