import { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useState, useRef } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'

type Step = 'upload' | 'preview' | 'mapping' | 'validate' | 'confirm'

interface ParsedRow { [key: string]: string }
interface SkipReason { row: number; name: string; reason: string }

const SHOP_FIELDS = [
  { key: 'name', label: 'Shop Name', required: true, hint: '' },
  { key: 'url', label: 'Website URL', required: true, hint: 'e.g. https://harborbakery.com' },
  { key: 'town', label: 'Town', required: false, hint: '' },
  { key: 'category', label: 'Category', required: false, hint: 'Must match a category name exactly' },
  { key: 'contact_name', label: 'Contact Name', required: false, hint: '' },
  { key: 'contact_email', label: 'Contact Email', required: false, hint: '' },
  { key: 'contact_phone', label: 'Contact Phone', required: false, hint: '' },
  { key: 'address', label: 'Address', required: false, hint: '' },
]

const TEMPLATE_HEADERS = 'name,url,town,category,contact_name,contact_email,contact_phone,address'
const TEMPLATE_EXAMPLE = 'Harbor Bakery,https://harborbakery.com,Gloucester,Food & Beverage,Jane Smith,jane@harborbakery.com,978-555-0100,12 Main St'

function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
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
  a.download = 'shops-template.csv'
  a.click()
}

export default function ImportCompanies() {
  const [step, setStep] = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [validationResult, setValidationResult] = useState<{
    valid: ParsedRow[]
    skipped: SkipReason[]
    duplicateUrls: string[]
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; skipped_reasons: SkipReason[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers, rows } = parseCsv(ev.target?.result as string)
      setHeaders(headers)
      setRows(rows)
      const autoMap: Record<string, string> = {}
      for (const f of SHOP_FIELDS) {
        const match = headers.find(h =>
          h.toLowerCase() === f.key.toLowerCase() ||
          h.toLowerCase() === f.label.toLowerCase() ||
          (f.key === 'url' && ['website', 'website_url', 'web', 'link', 'site'].includes(h.toLowerCase())) ||
          (f.key === 'name' && ['business', 'shop', 'store', 'business_name', 'shop_name'].includes(h.toLowerCase())) ||
          (f.key === 'category' && ['category_name', 'type', 'industry'].includes(h.toLowerCase()))
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
    const duplicateUrlSet = new Set<string>()
    const seenUrls = new Set<string>()

    rows.forEach((row, i) => {
      const rowNum = i + 2
      const name = mapping.name ? row[mapping.name] : ''
      const url = mapping.url ? row[mapping.url] : ''

      if (!name.trim()) {
        skipped.push({ row: rowNum, name: `Row ${rowNum}`, reason: 'Missing shop name' })
        return
      }
      if (!url.trim()) {
        skipped.push({ row: rowNum, name, reason: 'Missing website URL' })
        return
      }

      const urlKey = url.toLowerCase().trim()
      if (seenUrls.has(urlKey)) {
        duplicateUrlSet.add(url)
        skipped.push({ row: rowNum, name, reason: `Duplicate URL in file: ${url}` })
        return
      }
      seenUrls.add(urlKey)
      valid.push(row)
    })

    setValidationResult({ valid, skipped, duplicateUrls: [...duplicateUrlSet] })
    setStep('validate')
  }

  async function handleImport() {
    if (!validationResult) return
    setImporting(true)

    const mappedRows = validationResult.valid.map(row => ({
      name: mapping.name ? row[mapping.name] : '',
      url: mapping.url ? row[mapping.url] : '',
      town: mapping.town ? row[mapping.town] : undefined,
      category: mapping.category ? row[mapping.category] : undefined,
      contact_name: mapping.contact_name ? row[mapping.contact_name] : undefined,
      contact_email: mapping.contact_email ? row[mapping.contact_email] : undefined,
      contact_phone: mapping.contact_phone ? row[mapping.contact_phone] : undefined,
      address: mapping.address ? row[mapping.address] : undefined,
    }))

    const res = await fetch('/api/admin/companies/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: mappedRows }),
    })

    const data = await res.json()
    setResult(data)
    setImporting(false)
    setStep('confirm')
  }

  function reset() {
    setStep('upload')
    setResult(null)
    setRows([])
    setHeaders([])
    setMapping({})
    setValidationResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const steps: Step[] = ['upload', 'preview', 'mapping', 'validate', 'confirm']

  return (
    <AdminLayout title="Import Shops">
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/companies" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>← Companies</Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Import Shops via CSV</h1>

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
              Upload a CSV with shop data. You'll map columns in the next step.
            </p>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>
              Required: shop name, website URL. Shops with URLs already in the system will be skipped.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
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
              {SHOP_FIELDS.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
              ))}
            </div>

            <button
              onClick={validate}
              disabled={!mapping.name || !mapping.url}
              style={{ ...styles.primaryBtn, opacity: (!mapping.name || !mapping.url) ? 0.5 : 1 }}
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
              <strong style={{ color: '#166534' }}>✓ {validationResult.valid.length} shops ready to import</strong>
              {validationResult.valid.length > 0 && (
                <span style={{ color: '#166534', fontSize: 13, marginLeft: 8 }}>
                  — will be created with status Pending Review
                </span>
              )}
            </div>

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
                Import {validationResult.valid.length} shops →
              </button>
            </div>
          </>
        )}

        {/* STEP 5: CONFIRM + RESULT */}
        {step === 'confirm' && !result && validationResult && (
          <>
            <h2 style={styles.h2}>Confirm Import</h2>
            <p style={{ color: '#374151', marginBottom: 8 }}>
              About to import <strong>{validationResult.valid.length}</strong> shop{validationResult.valid.length !== 1 ? 's' : ''}.
              {validationResult.skipped.length > 0 && ` ${validationResult.skipped.length} row${validationResult.skipped.length !== 1 ? 's' : ''} will be skipped.`}
            </p>
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 24 }}>
              Imported shops will have status Active and verification status Pending Review.
            </p>
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
              <strong>{result.imported}</strong> shop{result.imported !== 1 ? 's' : ''} imported successfully.
            </p>
            {result.skipped > 0 && (
              <p style={{ color: '#9ca3af', fontSize: 14 }}>
                {result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped (duplicates or missing required fields).
              </p>
            )}
            <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 0 }}>
              All imported shops have verification status Pending Review.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <Link href="/admin/companies" style={{ ...styles.primaryBtn, textDecoration: 'none' }}>
                View Shops →
              </Link>
              <button onClick={reset} style={styles.secondaryBtn}>
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
  return { props: {} }
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
}
