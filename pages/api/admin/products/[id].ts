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

  const { id } = req.query as { id: string }
  const db = getAdminClient()

  if (req.method === 'PATCH') {
    const updates: Record<string, unknown> = {}
    const allowed = ['name', 'description', 'price', 'image_url', 'availability', 'category_id', 'sku', 'url', 'status', 'business_id']
    for (const key of allowed) {
      if (key in req.body) {
        let val = req.body[key]
        if (key === 'price') val = parseFloat(val)
        else if (typeof val === 'string' && ['name', 'description'].includes(key)) val = stripHtml(val)
        updates[key] = val
      }
    }

    // If image_urls array provided, sync product_images and set primary image_url
    if (Array.isArray(req.body.image_urls)) {
      const imageList: string[] = req.body.image_urls.filter((u: string) => u?.trim())
      updates.image_url = imageList[0] ?? null
      await db.from('product_images').delete().eq('product_id', id)
      if (imageList.length > 0) {
        await db.from('product_images').insert(
          imageList.map((imgUrl, idx) => ({ product_id: id, image_url: imgUrl, display_order: idx }))
        )
      }
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await db.from('products').update(updates).eq('id', id).select('id').single()
    if (error) return res.status(500).json({ error: error.message })

    // Update field overrides if provided
    if (Array.isArray(req.body.locked_fields)) {
      await db.from('product_field_overrides').delete().eq('product_id', id)
      if (req.body.locked_fields.length > 0) {
        await db.from('product_field_overrides').insert(
          req.body.locked_fields.map((f: string) => ({ product_id: id, field_name: f }))
        )
      }
    }

    return res.status(200).json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
