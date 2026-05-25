import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { scrapeShopPage } from '../../../../lib/scraper'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const products = await scrapeShopPage(url)
    return res.status(200).json({ products, count: products.length })
  } catch (err) {
    return res.status(500).json({ error: `Dry run failed: ${err}` })
  }
}
