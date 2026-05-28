import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { scrapeShopPage, scrapeProductDetail, type ScrapeMode } from '../../../../lib/scraper'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, mode, productUrls } = req.body as {
    url?: string
    mode?: ScrapeMode
    productUrls?: string[]
  }

  const resolvedMode: ScrapeMode = mode === 'products' ? 'products' : 'company'

  try {
    if (resolvedMode === 'products') {
      if (!productUrls || productUrls.length === 0) {
        return res.status(400).json({ error: 'productUrls is required when mode=products' })
      }
      const products = []
      for (const pu of productUrls.slice(0, 10)) {
        const p = await scrapeProductDetail(pu)
        if (p) products.push(p)
      }
      return res.status(200).json({ products, count: products.length, mode: resolvedMode })
    }

    if (!url) return res.status(400).json({ error: 'url is required when mode=company' })
    const products = await scrapeShopPage(url)
    return res.status(200).json({ products, count: products.length, mode: resolvedMode })
  } catch (err) {
    return res.status(500).json({ error: `Dry run failed: ${err}` })
  }
}
