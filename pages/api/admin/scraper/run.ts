import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'
import { scrapeAndUpsert } from '../../../../lib/scraper'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { businessId } = req.body
  if (!businessId) return res.status(400).json({ error: 'businessId is required' })

  const db = getAdminClient()
  const { data: business, error: fetchErr } = await db
    .from('businesses')
    .select('id, name, url')
    .eq('id', businessId)
    .single()

  if (fetchErr || !business) return res.status(404).json({ error: 'Business not found' })

  // Mark as running
  await db.from('businesses').update({ scrape_status: 'running' }).eq('id', businessId)

  try {
    const { upserted, errors, diff } = await scrapeAndUpsert({
      businessId: business.id,
      businessName: business.name,
      urls: [business.url],
    })

    await db.from('businesses').update({
      scrape_status: 'success',
      last_scraped: new Date().toISOString(),
      last_scrape_diff: diff,
    }).eq('id', businessId)

    return res.status(200).json({ upserted, errors, diff })
  } catch (err) {
    await db.from('businesses').update({ scrape_status: 'error' }).eq('id', businessId)
    return res.status(500).json({ error: `Scrape failed: ${err}` })
  }
}
