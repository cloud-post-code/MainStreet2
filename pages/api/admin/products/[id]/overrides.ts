import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]'
import { getAdminClient } from '../../../../../lib/admin/supabase-admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query
  const { field_name } = req.body

  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Product id required' })
  if (!field_name) return res.status(400).json({ error: 'field_name required' })

  const db = getAdminClient()
  const { error } = await db
    .from('product_field_overrides')
    .upsert({ product_id: id, field_name }, { onConflict: 'product_id,field_name' })

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
