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
    const allowed = [
      'name', 'url', 'town', 'category_id', 'verification_status',
      'contact_name', 'contact_email', 'contact_phone',
      'address_street', 'address_city', 'address_state', 'address_zip',
      'status',
    ]
    for (const key of allowed) {
      if (key in req.body) {
        updates[key] = typeof req.body[key] === 'string' && ['name', 'town', 'contact_name', 'address_street', 'address_city'].includes(key)
          ? stripHtml(req.body[key])
          : req.body[key]
      }
    }
    updates.updated_at = new Date().toISOString()

    const { data, error } = await db
      .from('businesses')
      .update(updates)
      .eq('id', id)
      .select('id')
      .single()

    if (error) return res.status(500).json({ error: error.message })

    // Cascade deactivation to products
    if (updates.status === 'deactivated') {
      await db.from('products').update({ status: 'deactivated', updated_at: new Date().toISOString() }).eq('business_id', id)
    }

    return res.status(200).json(data)
  }

  if (req.method === 'DELETE') {
    await db.from('products').update({ status: 'deactivated' }).eq('business_id', id)
    const { error } = await db.from('businesses').update({ status: 'deactivated' }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
