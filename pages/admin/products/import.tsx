import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState, useRef } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

type Step = 'upload' | 'preview' | 'mapping' | 'validate' | 'confirm'

interface ParsedRow { [key: string]: string }
interface SkipReason { row: number; name: string; reason: string }

interface Props {
  categories: { id: string; name: string }[]
  shops: { id: string; name: string }[]
}

const PRODUCT_FIELDS = [
  { key: 'shop_name', label: 'Shop Name', required: true, hint: 'Must match a shop already in the system' },
  { key: 'name', label: 'Product Name', required: true, hint: '' },
  { key: 'price', label: 'Price', required: true, hint: 'Number, e.g. 24.99' },
  { key: 'description', label: 'Description', required: false, hint: '' },
  { key: 'category_name', label: 'Category', required: false, hint: 'Defaults to "Other" if blank or unrecognised' },
  { key: 'sku', label: 'SKU', required: false, hint: '' },
  { key: 'availability', label: 'Availability', required: false, hint: 'in_stock / out_of_stock / limited / unknown' },
  { key: 'image_url', label: 'Image URL', required: false, hint: '' },
  { key: 'url', label: 'Source URL', required: false, hint: '' },
]

const TEMPLATE_HEADERS = 'shop_name,name,price,description,category,sku,availability,image_url,source_url'
const TEMPLATE_EXAMPLE = 'Harbor Bakery,Sourdough Loaf,8.50,Fresh baked daily,Food & Beverage,HB-001,in_stock,,https://harborbakery.com/sourdough'

function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    // Simple CSV parse: handle quoted fields with commas
    const values: string[] = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuote = !inQuote }
      else if (line[i] === ',' && !inQuote) { values.push(cur.trim()); cur = '' }
      else cur += line[i]
    }
    values.push(cur.trim())
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  })
  return { headers, rows }
}

function downloadTemplate() {
  const csv = `${TEMPLATE_HEADERS}\n${TEMPLATE_EXAMPLE}\n`
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'products-template.csv'
  a.click()
}

export default function ImportProducts({ categories, shops }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [defaultCategoryId, setDefaultCategoryId] = useState('')
  const [validationResult, setValidationResult] = useState<{
    valid: ParsedRow[]
    skipped: SkipReason[]
    unknownShops: string[]
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; skipped_reasons: SkipReason[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const shopNames = new Set(shops.map(s => s.name.toLowerCase().trim()))

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers, rows } = parseCsv(ev.target?.result as string)
      setHeaders(headers)
      setRows(rows)
      const autoMap: Record<string, string> = {}
      for (const f of PRODUCT_FIELDS) {
        const match = headers.find(h =>
          h.toLowerCase() === f.key.toLowerCase() ||
          h.toLowerCase() === f.label.toLowerCase() ||
          (f.key === 'shop_name' && ['shop', 'business', 'store', 'company'].includes(h.toLowerCase())) ||
          (f.key === 'category_name' && h.toLowerCase() === 'category') ||
          (f.key === 'url' && ['source_url', 'source', 'product_url', 'link'].includes(h.toLowerCase()))
        )
        if (match) autoMap[f.key] = match
      }
      setMapping(autoMap)
      setStep('preview')
    }
    reader.readAsText(file)
  }

  function validate() {
    const valid: ParsedRow[] = []
    const skipped: SkipReason[] = []
    const unknownShopSet = new Set<string>()

    rows.forEach((row, i) => {
      const rowNum = i + 2
      const shopName = mapping.shop_name ? row[mapping.shop_name] : ''
      const name = mapping.name ? row[mapping.name] : ''
      const price = mapping.price ? row[mapping.price] : ''

      if (!shopName) {
        skipped.push({ row: rowNum, name: name || `Row ${rowNum}`, reason: 'Missing shop name' })
        return
      }
      if (!shopNames.has(shopName.toLowerCase().trim())) {
        unknownShopSet.add(shopName)
        skipped.push({ row: rowNum, name: name || `Row ${rowNum}`, reason: `Shop not found: "${shopName}"` })
        return
      }
      if (!name) {
        skipped.push({ row: rowNum, name: `Row ${rowNum}`, reason: 'Missing product name' })
        return
      }
      if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
        skipped.push({ row: rowNum, name, reason: `Invalid price: "${price}"` })
        return
      }
      valid.push(row)
    })

    setValidationResult({ valid, skipped, unknownShops: [...unknownShopSet] })
    setStep('validate')
  }

  async function handleImport() {
    if (!validationResult) return
    setImporting(true)

    const mappedRows = validationResult.valid.map(row => ({
      shop_name: mapping.shop_name ? row[mapping.shop_name] : '',
      name: mapping.name ? row[mapping.name] : '',
      price: mapping.price ? row[mapping.price] : '',
      description: mapping.description ? row[mapping.description] : undefined,
      category_name: mapping.category_name ? row[mapping.category_name] : undefined,
      sku: mapping.sku ? row[mapping.sku] : undefined,
      availability: mapping.availability ? row[mapping.availability] : undefined,
      image_url: mapping.image_url ? row[mapping.image_url] : undefined,
      url: mapping.url ? row[mapping.url] : undefined,
    }))

    const res = await fetch('/api/admin/products/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: mappedRows, default_category_id: defaultCategoryId }),
    })

    const data = await res.json()
    setResult(data)
    setImporting(false)
    setStep('confirm')
  }

  const steps: Step[] = ['upload', 'preview', 'mapping', 'validate', 'confirm']

  return (
    <AdminLayout title="Import Products">
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/products" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>← Products</Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Import Products via CSV</h1>

      <div style={styles.steps}>
        {steps.map((s, i) => (
          <div key={s} style={{
            ...styles.stepDot,
            ...(step === s ? styles.stepActive : steps.indexOf(step) > i ? styles.stepDone : {}),
          }}>
            {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
          </div>
        ))}
      </div>

      <div style={styles.card}>
        {/* STEP 1: UPLOAD */}
        {step === 'upload' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: '#6b7280', marginBottom: 8 }}>
              Upload a CSV with product data. You'll map columns in the next step.
            </p>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>
              Required columns: shop name, product name, price. Shop names must match shops already in the system.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 24 }}>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={styles.primaryBtn}>Choose CSV file</button>
              <button onClick={downloadTemplate} style={styles.secondaryBtn}>Download template</button>
            </div>
          </div>
        )}

        {/* STEP 2: PREVIEW */}
        {step === 'preview' && (
          <>
            <h2 style={styles.h2}>Preview — {rows.length} rows found</h2>
            <div style={{ overflowX: 'auto', marginBottom: 20 }}>
              <table style={styles.table}>
                <thead>
                  <tr>{headers.map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>{headers.map(h => <td key={h} style={styles.td}>{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 5 && <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 8 }}>…and {rows.length - 5} more rows</p>}
            </div>
            <button onClick={() => setStep('mapping')} style={styles.primaryBtn}>Next: Map columns →</button>
          </>
        )}

        {/* STEP 3: MAPPING */}
        {step === 'mapping' && (
          <>
            <h2 style={styles.h2}>Map Columns</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
              {PRODUCT_FIELDS.map(f => (
                <div key={f.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <label style={{ width: 150, fontSize: 14, fontWeight: 600, color: '#374151', flexShrink: 0 }}>
                      {f.label}{f.required ? <span style={{ color: '#ef4444' }}> *</span> : ''}
                    </label>
                    <select
                      value={mapping[f.key] ?? ''}
                      onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                      style={{ ...styles.select, width: 220 }}
                    >
                      <option value="">— skip —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    {f.hint && <span style={{ fontSize: 12, color: '#9ca3af' }}>{f.hint}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 20, marginBottom: 24 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
                Default category <span style={{ color: '#9ca3af', fontWeight: 400 }}>(used when category column is blank or unrecognised)</span>
              </label>
              <select
                value={defaultCategoryId}
                onChange={e => setDefaultCategoryId(e.target.value)}
                style={{ ...styles.select, width: 280 }}
              >
                <option value="">Other</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {!mapping.shop_name && (
              <div style={styles.warning}>
                Shop Name column is required. Map it to proceed.
              </div>
            )}

            <button
              onClick={validate}
              disabled={!mapping.shop_name || !mapping.name || !mapping.price}
              style={{ ...styles.primaryBtn, opacity: (!mapping.shop_name || !mapping.name || !mapping.price) ? 0.5 : 1 }}
            >
              Next: Validate →
            </button>
          </>
        )}

        {/* STEP 4: VALIDATE */}
        {step === 'validate' && validationResult && (
          <>
            <h2 style={styles.h2}>Validation</h2>

            <div style={{ ...styles.infoBox, background: '#dcfce7', borderColor: '#86efac', marginBottom: 16 }}>
              <strong style={{ color: '#166534' }}>✓ {validationResult.valid.length} products ready to import</strong>
            </div>

            {validationResult.unknownShops.length > 0 && (
              <div style={{ ...styles.infoBox, background: '#fef3c7', borderColor: '#fcd34d', marginBottom: 16 }}>
                <strong style={{ color: '#92400e', display: 'block', marginBottom: 6 }}>
                  Shops not found in system — rows will be skipped:
                </strong>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#92400e' }}>
                  {validationResult.unknownShops.map(s => <li key={s}>{s}</li>)}
                </ul>
                <p style={{ fontSize: 12, color: '#78350f', marginTop: 8, marginBottom: 0 }}>
                  Import these shops first via <Link href="/admin/companies/import" style={{ color: '#78350f' }}>Companies → Import CSV</Link>, then re-upload this file.
                </p>
              </div>
            )}

            {validationResult.skipped.length > 0 && (
              <div style={{ ...styles.infoBox, background: '#fef2f2', borderColor: '#fca5a5', marginBottom: 16 }}>
                <strong style={{ color: '#991b1b', display: 'block', marginBottom: 6 }}>
                  {validationResult.skipped.length} rows will be skipped:
                </strong>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#dc2626' }}>
                  {validationResult.skipped.slice(0, 10).map((s, i) => (
                    <li key={i}>Row {s.row} ({s.name}): {s.reason}</li>
                  ))}
                  {validationResult.skipped.length > 10 && (
                    <li style={{ color: '#9ca3af' }}>…and {validationResult.skipped.length - 10} more</li>
                  )}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('mapping')} style={styles.secondaryBtn}>← Back</button>
              <button
                onClick={() => setStep('confirm')}
                disabled={validationResult.valid.length === 0}
                style={{ ...styles.primaryBtn, opacity: validationResult.valid.length === 0 ? 0.5 : 1 }}
              >
                Import {validationResult.valid.length} products →
              </button>
            </div>
          </>
        )}

        {/* STEP 5: CONFIRM + RESULT */}
        {step === 'confirm' && !result && validationResult && (
          <>
            <h2 style={styles.h2}>Confirm Import</h2>
            <p style={{ color: '#374151', marginBottom: 8 }}>
              About to import <strong>{validationResult.valid.length}</strong> product{validationResult.valid.length !== 1 ? 's' : ''}.
              {validationResult.skipped.length > 0 && ` ${validationResult.skipped.length} row${validationResult.skipped.length !== 1 ? 's' : ''} will be skipped.`}
            </p>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>This cannot be undone. Products will be created with status Active.</p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('validate')} style={styles.secondaryBtn} disabled={importing}>← Back</button>
              <button onClick={handleImport} disabled={importing} style={styles.primaryBtn}>
                {importing ? 'Importing…' : 'Confirm Import'}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && result && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <h2 style={styles.h2}>Import Complete</h2>
            <p style={{ color: '#374151', marginBottom: 4, fontSize: 16 }}>
              <strong>{result.imported}</strong> product{result.imported !== 1 ? 's' : ''} imported successfully.
            </p>
            {result.skipped > 0 && (
              <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 0 }}>
                {result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped.
              </p>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <Link href="/admin/products" style={{ ...styles.primaryBtn, textDecoration: 'none' }}>
                View Products →
              </Link>
              <button onClick={() => { setStep('upload'); setResult(null); setRows([]); setHeaders([]); setMapping({}); setValidationResult(null) }} style={styles.secondaryBtn}>
                Import another file
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const db = getAdminClient()
  const [{ data: categories }, { data: shops }] = await Promise.all([
    db.from('categories').select('id, name').order('name'),
    db.from('businesses').select('id, name').eq('status', 'active').order('name'),
  ])
  return { props: { categories: categories ?? [], shops: shops ?? [] } }
}

const styles: Record<string, React.CSSProperties> = {
  steps: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  stepDot: { padding: '6px 14px', borderRadius: 20, background: '#f3f4f6', fontSize: 13, color: '#9ca3af', fontWeight: 500 },
  stepActive: { background: '#015237', color: '#fff' },
  stepDone: { background: '#dcfce7', color: '#166534' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '28px 32px' },
  h2: { fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 20px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' },
  td: { padding: '8px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151' },
  select: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff' },
  primaryBtn: { padding: '10px 24px', background: '#015237', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', color: '#374151' },
  infoBox: { border: '1px solid', borderRadius: 8, padding: '12px 16px' },
  warning: { background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 16 },
}
