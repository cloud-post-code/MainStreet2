import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business_id, name, description, price, image_url, image_urls, availability, category_id, sku, url, locked_fields } = req.body

  if (!business_id || !name || price === undefined || !category_id) {
    return res.status(400).json({ error: 'business_id, name, price, and category_id are required' })
  }

  const priceNum = parseFloat(price)
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' })
  }

  // Normalize image list: prefer image_urls array, fall back to single image_url
  const imageList: string[] = Array.isArray(image_urls)
    ? image_urls.filter((u: string) => u?.trim())
    : image_url ? [image_url] : []
  const primaryImage = imageList[0] ?? null

  const db = getAdminClient()
  const { data, error } = await db
    .from('products')
    .insert({
      business_id,
      business_name: '',
      name: stripHtml(name),
      description: description ? stripHtml(description) : null,
      price: priceNum,
      image_url: primaryImage,
      availability: availability ?? 'unknown',
      category_id,
      sku: sku || null,
      url: url || null,
      status: 'active',
      updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Set business_name from join
  const { data: biz } = await db.from('businesses').select('name').eq('id', business_id).single()
  if (biz) {
    await db.from('products').update({ business_name: biz.name }).eq('id', data.id)
  }

  // Sync product_images
  if (imageList.length > 0) {
    await db.from('product_images').insert(
      imageList.map((imgUrl, idx) => ({ product_id: data.id, image_url: imgUrl, display_order: idx }))
    )
  }

  // Save field overrides
  if (Array.isArray(locked_fields) && locked_fields.length > 0) {
    await db.from('product_field_overrides').insert(
      locked_fields.map((f: string) => ({ product_id: data.id, field_name: f }))
    )
  }

  return res.status(201).json(data)
}
