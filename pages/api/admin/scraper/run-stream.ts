import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'
import { scrapeAndUpsert } from '../../../../lib/scraper'

// SSE stream — no bodyParser needed on GET; no 30s timeout (allow up to 120s)
export const config = { api: { responseLimit: false } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { businessId } = req.query
  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ error: 'businessId query param required' })
  }

  const db = getAdminClient()
  const { data: business, error: fetchErr } = await db
    .from('businesses')
    .select('id, name, url')
    .eq('id', businessId)
    .single()

  if (fetchErr || !business) return res.status(404).json({ error: 'Business not found' })

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const controller = new AbortController()

  // Abort scrape when client disconnects
  req.on('close', () => controller.abort())

  const send = (msg: string) => {
    try {
      res.write(`data: ${JSON.stringify(msg)}\n\n`)
      // @ts-ignore — flush available in Node.js HTTP
      if (typeof res.flush === 'function') res.flush()
    } catch {
      // Client disconnected
    }
  }

  send(`Starting scrape for ${business.name}...`)
  await db.from('businesses').update({ scrape_status: 'running' }).eq('id', businessId)

  try {
    const { upserted, errors, diff } = await scrapeAndUpsert(
      { businessId: business.id, businessName: business.name, urls: [business.url] },
      { log: send, signal: controller.signal }
    )

    if (controller.signal.aborted) {
      await db.from('businesses').update({ scrape_status: 'cancelled' }).eq('id', businessId)
      send('CANCELLED')
    } else {
      await db.from('businesses').update({
        scrape_status: 'success',
        last_scraped: new Date().toISOString(),
        last_scrape_diff: diff,
        updated_at: new Date().toISOString(),
      }).eq('id', businessId)
      send(`DONE: ${upserted} products, ${errors} errors. +${diff.added} new, ${diff.priceChanges.length} price changes, ${diff.removed} removed`)
    }
  } catch (err) {
    await db.from('businesses').update({ scrape_status: 'error' }).eq('id', businessId)
    send(`ERROR: ${err}`)
  }

  res.end()
}
