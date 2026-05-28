import { useState, FormEvent } from 'react'
import { useRouter } from 'next/router'

interface Category { id: string; name: string }

interface CompanyFormData {
  name: string
  url: string
  town: string
  category_id: string
  verification_status: string
  contact_name: string
  contact_email: string
  contact_phone: string
  address_street: string
  address_city: string
  address_state: string
  address_zip: string
}

interface Props {
  initial?: Partial<CompanyFormData>
  categories: Category[]
  companyId?: string
}

const VERIF_OPTIONS = [
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'needs_info', label: 'Needs Info' },
]

export default function CompanyForm({ initial, categories, companyId }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<CompanyFormData>({
    name: initial?.name ?? '',
    url: initial?.url ?? '',
    town: initial?.town ?? '',
    category_id: initial?.category_id ?? '',
    verification_status: initial?.verification_status ?? 'verified',
    contact_name: initial?.contact_name ?? '',
    contact_email: initial?.contact_email ?? '',
    contact_phone: initial?.contact_phone ?? '',
    address_street: initial?.address_street ?? '',
    address_city: initial?.address_city ?? '',
    address_state: initial?.address_state ?? '',
    address_zip: initial?.address_zip ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function set(field: keyof CompanyFormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const endpoint = companyId
      ? `/api/admin/companies/${companyId}`
      : '/api/admin/companies'
    const method = companyId ? 'PATCH' : 'POST'

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to save.')
      setSaving(false)
      return
    }

    const saved = await res.json()
    router.push(`/admin/companies/${saved.id}`)
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Basic Info</h2>
        <div style={styles.row}>
          <Field label="Business Name *">
            <input value={form.name} onChange={e => set('name', e.target.value)} required style={styles.input} />
          </Field>
          <Field label="Website URL *">
            <input
              value={form.url}
              onChange={e => set('url', e.target.value)}
              required
              type="url"
              placeholder="https://"
              style={styles.input}
            />
          </Field>
        </div>
        <div style={styles.row}>
          <Field label="Town *">
            <input value={form.town} onChange={e => set('town', e.target.value)} required style={styles.input} />
          </Field>
          <Field label="Category *">
            <select value={form.category_id} onChange={e => set('category_id', e.target.value)} required style={styles.select}>
              <option value="">Select category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Verification Status">
            <select value={form.verification_status} onChange={e => set('verification_status', e.target.value)} style={styles.select}>
              {VERIF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Contact</h2>
        <div style={styles.row}>
          <Field label="Contact Name">
            <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} style={styles.input} />
          </Field>
          <Field label="Contact Email">
            <input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} style={styles.input} />
          </Field>
          <Field label="Contact Phone">
            <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} style={styles.input} />
          </Field>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Address</h2>
        <div style={styles.row}>
          <Field label="Street" style={{ flex: 2 }}>
            <input value={form.address_street} onChange={e => set('address_street', e.target.value)} style={styles.input} />
          </Field>
        </div>
        <div style={styles.row}>
          <Field label="City">
            <input value={form.address_city} onChange={e => set('address_city', e.target.value)} style={styles.input} />
          </Field>
          <Field label="State">
            <input value={form.address_state} onChange={e => set('address_state', e.target.value)} style={styles.input} maxLength={2} />
          </Field>
          <Field label="ZIP">
            <input value={form.address_zip} onChange={e => set('address_zip', e.target.value)} style={styles.input} />
          </Field>
        </div>
      </section>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.actions}>
        <button type="button" onClick={() => router.back()} style={styles.cancelBtn}>Cancel</button>
        <button type="submit" disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving…' : companyId ? 'Save Changes' : 'Add Company'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, ...style }}>
      <label style={fieldStyles.label}>{label}</label>
      {children}
    </div>
  )
}

const fieldStyles = {
  label: { fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
}

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 0 },
  section: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '24px 28px',
    marginBottom: 20,
  },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 18px' },
  row: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  input: {
    padding: '9px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box' as const,
    marginTop: 4,
  },
  select: {
    padding: '9px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    width: '100%',
    boxSizing: 'border-box' as const,
    marginTop: 4,
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 14,
    color: '#dc2626',
    marginBottom: 16,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 12 },
  cancelBtn: {
    padding: '10px 20px',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    color: '#374151',
  },
  saveBtn: {
    padding: '10px 24px',
    background: '#015237',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
