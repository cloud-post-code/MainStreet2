import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

interface ShopRow {
  name: string
  url: string
  town?: string
  category?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  address?: string
}

interface SkipReason {
  row: number
  name: string
  reason: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { rows } = req.body as { rows: ShopRow[] }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array is required' })
  }

  const db = getAdminClient()

  // Fetch existing URLs and categories once
  const [{ data: existing }, { data: categories }] = await Promise.all([
    db.from('businesses').select('url'),
    db.from('categories').select('id, name'),
  ])

  const existingUrls = new Set((existing ?? []).map(b => b.url.toLowerCase().trim()))

  const catByName: Record<string, string> = {}
  let defaultCategoryId = ''
  ;(categories ?? []).forEach(c => {
    catByName[c.name.toLowerCase().trim()] = c.id
    if (c.name.toLowerCase() === 'other') defaultCategoryId = c.id
  })

  const toInsert: Record<string, unknown>[] = []
  const skipped: SkipReason[] = []
  const seenUrls = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    const nameClean = stripHtml((row.name ?? '').trim())
    if (!nameClean) {
      skipped.push({ row: rowNum, name: `Row ${rowNum}`, reason: 'Missing shop name' })
      continue
    }

    const urlClean = (row.url ?? '').trim()
    if (!urlClean) {
      skipped.push({ row: rowNum, name: nameClean, reason: 'Missing website URL' })
      continue
    }

    const urlKey = urlClean.toLowerCase()
    if (existingUrls.has(urlKey) || seenUrls.has(urlKey)) {
      skipped.push({ row: rowNum, name: nameClean, reason: `Already exists: ${urlClean}` })
      continue
    }
    seenUrls.add(urlKey)

    const catKey = (row.category ?? '').toLowerCase().trim()
    const categoryId = catByName[catKey] ?? defaultCategoryId

    toInsert.push({
      name: nameClean,
      url: urlClean,
      town: row.town ? stripHtml(row.town) : '',
      category_id: categoryId || null,
      contact_name: row.contact_name ? stripHtml(row.contact_name) : null,
      contact_email: row.contact_email || null,
      contact_phone: row.contact_phone || null,
      address_street: row.address ? stripHtml(row.address) : null,
      selectors: {},
      status: 'active',
      verification_status: 'pending_review',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
  }

  let imported = 0
  if (toInsert.length > 0) {
    const { data, error } = await db.from('businesses').insert(toInsert).select('id')
    if (error) return res.status(500).json({ error: error.message })
    imported = data?.length ?? 0
  }

  return res.status(200).json({ imported, skipped: skipped.length, skipped_reasons: skipped })
}
