import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const db = getAdminClient()
  const { businessId, all } = req.query

  if (all === 'true') {
    const { data } = await db
      .from('businesses')
      .select('id, name, scrape_status, last_scraped, last_scrape_diff')
    return res.status(200).json({ businesses: data ?? [] })
  }

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ error: 'businessId or all=true required' })
  }

  const { data, error } = await db
    .from('businesses')
    .select('id, scrape_status, last_scraped, last_scrape_diff')
    .eq('id', businessId)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Business not found' })

  return res.status(200).json(data)
}
