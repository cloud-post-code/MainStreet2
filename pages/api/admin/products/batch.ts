import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

interface ProductRow {
  shop_name: string
  name: string
  price: string | number
  description?: string
  sku?: string
  availability?: string
  image_url?: string
  image_urls?: string   // pipe-separated list of additional images
  url?: string
  category_name?: string
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

  const { rows, default_category_id } = req.body as {
    rows: ProductRow[]
    default_category_id?: string
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array is required' })
  }

  const db = getAdminClient()

  // Fetch all active businesses and categories once
  const [{ data: businesses }, { data: categories }] = await Promise.all([
    db.from('businesses').select('id, name, url').eq('status', 'active'),
    db.from('categories').select('id, name'),
  ])

  const bizByName: Record<string, { id: string; name: string }> = {}
  ;(businesses ?? []).forEach(b => {
    bizByName[b.name.toLowerCase().trim()] = b
  })

  const catByName: Record<string, string> = {}
  let defaultCategoryId = default_category_id ?? ''
  ;(categories ?? []).forEach(c => {
    catByName[c.name.toLowerCase().trim()] = c.id
    if (c.name.toLowerCase() === 'other' && !defaultCategoryId) {
      defaultCategoryId = c.id
    }
  })

  const toInsert: Record<string, unknown>[] = []
  const skipped: SkipReason[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // 1-indexed + header row

    const shopKey = (row.shop_name ?? '').toLowerCase().trim()
    const biz = bizByName[shopKey]
    if (!biz) {
      skipped.push({ row: rowNum, name: row.name || `Row ${rowNum}`, reason: `Shop not found: "${row.shop_name}"` })
      continue
    }

    const nameClean = stripHtml((row.name ?? '').trim())
    if (!nameClean) {
      skipped.push({ row: rowNum, name: `Row ${rowNum}`, reason: 'Missing product name' })
      continue
    }

    const price = parseFloat(String(row.price))
    if (isNaN(price) || price < 0) {
      skipped.push({ row: rowNum, name: nameClean, reason: `Invalid price: "${row.price}"` })
      continue
    }

    const catKey = (row.category_name ?? '').toLowerCase().trim()
    const categoryId = catByName[catKey] ?? defaultCategoryId
    if (!categoryId) {
      skipped.push({ row: rowNum, name: nameClean, reason: 'No category found and no default category set' })
      continue
    }

    const VALID_AVAIL = ['in_stock', 'out_of_stock', 'limited', 'unknown']
    const availability = VALID_AVAIL.includes((row.availability ?? '').toLowerCase())
      ? row.availability!.toLowerCase()
      : 'unknown'

    // Collect all image URLs: combine image_url and pipe-separated image_urls columns
    const allImageUrls: string[] = []
    if (row.image_url?.trim()) allImageUrls.push(row.image_url.trim())
    if (row.image_urls) {
      for (const u of row.image_urls.split('|')) {
        const trimmed = u.trim()
        if (trimmed && !allImageUrls.includes(trimmed)) allImageUrls.push(trimmed)
      }
    }

    toInsert.push({
      business_id: biz.id,
      business_name: biz.name,
      name: nameClean,
      description: row.description ? stripHtml(row.description) : null,
      price,
      image_url: allImageUrls[0] ?? null,
      image_urls: allImageUrls,
      availability,
      category_id: categoryId,
      sku: row.sku || null,
      url: row.url || null,
      status: 'active',
      updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })
  }

  let imported = 0
  if (toInsert.length > 0) {
    const { data, error } = await db.from('products').insert(toInsert).select('id')
    if (error) return res.status(500).json({ error: error.message })
    imported = data?.length ?? 0
  }

  return res.status(200).json({ imported, skipped: skipped.length, skipped_reasons: skipped })
}
