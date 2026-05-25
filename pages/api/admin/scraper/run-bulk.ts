import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'
import { scrapeAndUpsert, STALE_THRESHOLD_DAYS } from '../../../../lib/scraper'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const db = getAdminClient()
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - STALE_THRESHOLD_DAYS)

  const { data: stale } = await db
    .from('businesses')
    .select('id, name, url')
    .or(`last_scraped.is.null,last_scraped.lt.${staleDate.toISOString()}`)
    .eq('scrape_status', 'never')
    .neq('scrape_status', 'running')

  const businesses = stale ?? []
  if (businesses.length === 0) {
    return res.status(200).json({ queued: 0, message: 'No stale businesses to scrape' })
  }

  // Return immediately; run sequentially in background (one at a time — Playwright is RAM-heavy)
  res.status(200).json({ queued: businesses.length })

  // Background sequential loop — runs after response is sent
  setImmediate(async () => {
    for (const biz of businesses) {
      await db.from('businesses').update({ scrape_status: 'running' }).eq('id', biz.id)
      try {
        const { diff } = await scrapeAndUpsert({
          businessId: biz.id,
          businessName: biz.name,
          urls: [biz.url],
        })
        await db.from('businesses').update({
          scrape_status: 'success',
          last_scraped: new Date().toISOString(),
          last_scrape_diff: diff,
        }).eq('id', biz.id)
      } catch {
        await db.from('businesses').update({ scrape_status: 'error' }).eq('id', biz.id)
      }
    }
  })
}
