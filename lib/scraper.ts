import { chromium } from 'playwright'
import { getSupabaseClient } from './supabase'
import { sanitizeProductText } from './scraper-sanitize'

const DOMAIN_DELAY_MS = 2000

interface ScrapeTarget {
  businessId: string
  businessName: string
  urls: string[]
}

interface RawProduct {
  name: string
  price: number
  url: string
  imageUrl?: string
  description?: string
}

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
  })
  const data = await resp.json() as { data: Array<{ embedding: number[] }> }
  return data.data[0].embedding
}

async function scrapeShopPage(url: string): Promise<RawProduct[]> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const products: RawProduct[] = []

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })

    // Generic extraction — works for most Shopify-style storefronts
    const items = await page.$$eval('[data-product-id], .product-item, .grid-item', nodes =>
      nodes.slice(0, 50).map(node => {
        const nameEl = node.querySelector('[class*="title"], [class*="name"], h2, h3')
        const priceEl = node.querySelector('[class*="price"]')
        const imgEl = node.querySelector('img')
        const linkEl = node.querySelector('a')
        return {
          name: nameEl?.textContent?.trim() ?? '',
          price: priceEl?.textContent?.trim() ?? '',
          imageUrl: imgEl?.getAttribute('src') ?? imgEl?.getAttribute('data-src') ?? '',
          url: linkEl?.href ?? '',
        }
      })
    )

    for (const item of items) {
      if (!item.name || !item.url) continue
      const priceNum = parseFloat(item.price.replace(/[^0-9.]/g, ''))
      if (isNaN(priceNum) || priceNum <= 0) continue
      products.push({
        name: item.name,
        price: priceNum,
        url: item.url,
        imageUrl: item.imageUrl || undefined,
      })
    }
  } finally {
    await browser.close()
  }

  return products
}

export async function scrapeAndUpsert(target: ScrapeTarget): Promise<{ upserted: number; errors: number }> {
  const supabase = getSupabaseClient()
  let upserted = 0
  let errors = 0

  // Baseline: count products before scraping to detect anomalies
  const { count: before } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', target.businessId)

  for (const url of target.urls) {
    await new Promise(r => setTimeout(r, DOMAIN_DELAY_MS))

    let products: RawProduct[]
    try {
      products = await scrapeShopPage(url)
    } catch (err) {
      console.error(`scrape failed for ${url}:`, err)
      errors++
      continue
    }

    for (const product of products) {
      try {
        const cleanName = sanitizeProductText(product.name)
        const cleanDesc = product.description ? sanitizeProductText(product.description) : ''
        const embedInput = cleanDesc ? `${cleanName} ${cleanDesc}` : cleanName
        const embedding = await embedText(embedInput)

        await supabase.from('products').upsert(
          {
            business_id: target.businessId,
            business_name: target.businessName,
            name: cleanName,
            description: cleanDesc || null,
            price: product.price,
            url: product.url,
            image_url: product.imageUrl ?? null,
            embedding,
            last_seen: new Date().toISOString(),
          },
          { onConflict: 'url' }
        )
        upserted++
      } catch (err) {
        console.error(`embed/upsert failed for ${product.url}:`, err)
        errors++
      }
    }
  }

  // Anomaly guard: warn if product count drops by >40%
  const { count: after } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', target.businessId)

  if (before && after && after < before * 0.6) {
    console.warn(`Product count dropped from ${before} to ${after} for business ${target.businessId}`)
  }

  return { upserted, errors }
}
