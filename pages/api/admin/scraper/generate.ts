import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'
import Anthropic from '@anthropic-ai/sdk'
import { chromium } from 'playwright'

const client = new Anthropic()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, notes, businessId } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  // Render page with Playwright to handle JS-heavy storefronts
  let html = ''
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    html = await page.evaluate(() => {
      const grid = document.querySelector('.product-grid, [data-product-id], main, #MainContent')
      return (grid?.innerHTML ?? document.body.innerHTML).slice(0, 8000)
    })
  } catch (err) {
    await browser.close()
    return res.status(502).json({ error: `Failed to load page: ${err}` })
  }
  await browser.close()

  const prompt = `You are a web scraping assistant. Analyze this HTML from a product listing page and return CSS selectors for scraping products.

URL: ${url}
${notes ? `Operator notes: ${notes}` : ''}

HTML (truncated):
${html}

Return a JSON object with these fields (CSS selectors):
{
  "nameSelector": "selector for product name",
  "priceSelector": "selector for product price",
  "imageSelector": "selector for product image",
  "linkSelector": "selector for product link",
  "containerSelector": "selector for product container element"
}

Return ONLY valid JSON, no explanation.`

  let selectors: Record<string, string>
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')
    selectors = JSON.parse(jsonMatch[0])
  } catch (err) {
    return res.status(500).json({ error: `Config generation failed: ${err}` })
  }

  // If a businessId is provided, save url, selectors, and notes to the business
  if (businessId) {
    const db = getAdminClient()
    await db.from('businesses').update({
      url,
      selectors,
      scrape_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', businessId)
  }

  return res.status(200).json({ selectors })
}
