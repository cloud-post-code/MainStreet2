import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const { businessId } = req.body
  if (!businessId) return res.status(400).json({ error: 'businessId is required' })

  const db = getAdminClient()
  const { error } = await db
    .from('businesses')
    .update({ scrape_status: 'error' })
    .eq('id', businessId)
    .eq('scrape_status', 'running')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
