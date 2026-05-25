import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'

interface Category { id: string; name: string }
interface Company { id: string; name: string }

interface ProductFormData {
  business_id: string
  name: string
  description: string
  price: string
  image_urls: string[]
  availability: string
  category_id: string
  sku: string
  url: string
}

interface Props {
  initial?: Partial<Omit<ProductFormData, 'image_urls'> & { image_url?: string; image_urls?: string[] }>
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

  // Normalize image URLs from initial: prefer image_urls array, fall back to image_url
  const initialImages: string[] = initial?.image_urls?.length
    ? initial.image_urls
    : initial?.image_url ? [initial.image_url] : []

  const [form, setForm] = useState<ProductFormData>({
    business_id: initial?.business_id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    price: initial?.price ?? '',
    image_urls: initialImages,
    availability: initial?.availability ?? 'unknown',
    category_id: initial?.category_id ?? '',
    sku: initial?.sku ?? '',
    url: initial?.url ?? '',
  })
  const [locked, setLocked] = useState<Set<string>>(new Set(lockedFields))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({})

  function set(field: keyof Omit<ProductFormData, 'image_urls'>, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function setImageUrl(idx: number, value: string) {
    setForm(f => {
      const next = [...f.image_urls]
      next[idx] = value
      return { ...f, image_urls: next }
    })
    setImageErrors(e => ({ ...e, [idx]: false }))
  }

  function addImage() {
    setForm(f => ({ ...f, image_urls: [...f.image_urls, ''] }))
  }

  function removeImage(idx: number) {
    setForm(f => ({ ...f, image_urls: f.image_urls.filter((_, i) => i !== idx) }))
    setImageErrors(e => {
      const next = { ...e }
      delete next[idx]
      return next
    })
  }

  function moveImage(from: number, to: number) {
    setForm(f => {
      const next = [...f.image_urls]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return { ...f, image_urls: next }
    })
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
    const image_urls = form.image_urls.filter(u => u.trim())
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, image_urls, locked_fields: [...locked] }),
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ ...styles.sectionTitle, margin: 0 }}>Images</h2>
          <button type="button" onClick={addImage} style={styles.addImgBtn}>+ Add image</button>
        </div>
        {form.image_urls.length === 0 && (
          <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No images yet. Click "Add image" to add one.</p>
        )}
        {form.image_urls.map((imgUrl, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {idx === 0 ? 'Primary image' : `Image ${idx + 1}`}
                </span>
                {idx > 0 && (
                  <button type="button" onClick={() => moveImage(idx, idx - 1)} title="Move up" style={styles.orderBtn}>↑</button>
                )}
                {idx < form.image_urls.length - 1 && (
                  <button type="button" onClick={() => moveImage(idx, idx + 1)} title="Move down" style={styles.orderBtn}>↓</button>
                )}
              </div>
              <input
                type="url"
                value={imgUrl}
                onChange={e => setImageUrl(idx, e.target.value)}
                style={styles.input}
                placeholder="https://"
              />
              {imageErrors[idx] && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#ef4444' }}>Image failed to load.</div>
              )}
            </div>
            {imgUrl && !imageErrors[idx] && (
              <img
                src={imgUrl}
                alt={`Preview ${idx + 1}`}
                onError={() => setImageErrors(e => ({ ...e, [idx]: true }))}
                style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 6, border: '1px solid #e5e7eb', flexShrink: 0, marginTop: 26 }}
              />
            )}
            <button type="button" onClick={() => removeImage(idx)} title="Remove image" style={{ ...styles.orderBtn, marginTop: 26, color: '#ef4444', borderColor: '#fca5a5' }}>✕</button>
          </div>
        ))}
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
  addImgBtn: { padding: '6px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#015237', cursor: 'pointer' },
  orderBtn: { padding: '2px 7px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#374151' },
}
