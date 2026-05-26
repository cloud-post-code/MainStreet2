/**
 * Scrapes Who Gives A Crap (us.whogivesacrap.org) via the Shopify JSON API,
 * then inserts the company and all products into the database.
 *
 * Usage: ts-node --project tsconfig.json scripts/scrape-who-gives-a-crap.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const INJECTION_PATTERNS = [/\n\nHuman:/gi, /\n\nAssistant:/gi, /<AnthropicArtifact/gi, /\[INST\]/gi, /<<SYS>>/gi]
function sanitizeProductText(text: string): string {
  let result = text
  for (const pattern of INJECTION_PATTERNS) result = result.replace(pattern, ' ')
  return result.trim()
}

const SHOP_NAME = 'Who Gives A Crap'
const SHOP_URL = 'https://us.whogivesacrap.org'
const COLLECTION_HANDLE = 'all'
const CATEGORY_NAME = 'Home & Garden'

interface ShopifyVariant {
  id: number
  title: string
  price: string
  sku: string
  available: boolean
}

interface ShopifyImage {
  src: string
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  body_html: string
  product_type: string
  variants: ShopifyVariant[]
  images: ShopifyImage[]
}

interface ShopifyResponse {
  products: ShopifyProduct[]
}

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = []
  let page = 1
  const limit = 250

  while (true) {
    const url = `${SHOP_URL}/collections/${COLLECTION_HANDLE}/products.json?limit=${limit}&page=${page}`
    console.log(`  Fetching page ${page}: ${url}`)

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MainStreetBot/1.0)' },
    })

    if (!resp.ok) {
      console.error(`  HTTP ${resp.status} on page ${page}`)
      break
    }

    const data = await resp.json() as ShopifyResponse
    if (!data.products || data.products.length === 0) break

    all.push(...data.products)
    console.log(`  Got ${data.products.length} products (total so far: ${all.length})`)

    if (data.products.length < limit) break
    page++

    // Polite delay between pages
    await new Promise(r => setTimeout(r, 500))
  }

  return all
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE env vars')
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // ── 1. Ensure the company exists ─────────────────────────────────────────
  console.log('\n[1/3] Upserting company...')

  const { data: categories } = await db.from('categories').select('id, name')
  const cat = (categories ?? []).find(c => c.name.toLowerCase() === CATEGORY_NAME.toLowerCase())
  const otherCat = (categories ?? []).find(c => c.name.toLowerCase() === 'other')
  const categoryId = cat?.id ?? otherCat?.id ?? null

  // Check if company already exists by URL
  const { data: existing } = await db
    .from('businesses')
    .select('id, name')
    .ilike('url', `${SHOP_URL}%`)
    .limit(1)
    .single()

  let businessId: string
  let businessName: string

  if (existing) {
    businessId = existing.id
    businessName = existing.name
    console.log(`  Company already exists: ${businessName} (${businessId})`)
  } else {
    const { data: inserted, error } = await db
      .from('businesses')
      .insert({
        name: SHOP_NAME,
        url: SHOP_URL,
        town: '',
        category_id: categoryId,
        selectors: {},
        status: 'active',
        verification_status: 'pending_review',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id, name')
      .single()

    if (error || !inserted) {
      console.error('Failed to insert company:', error?.message)
      process.exit(1)
    }

    businessId = inserted.id
    businessName = inserted.name
    console.log(`  Company inserted: ${businessName} (${businessId})`)
  }

  // ── 2. Fetch products from Shopify API ────────────────────────────────────
  console.log('\n[2/3] Fetching products from Shopify JSON API...')
  const shopifyProducts = await fetchAllProducts()
  console.log(`  Total products fetched: ${shopifyProducts.length}`)

  if (shopifyProducts.length === 0) {
    console.error('No products found. The site may have blocked the request or changed its API.')
    process.exit(1)
  }

  // ── 3. Embed and upsert products ─────────────────────────────────────────
  console.log('\n[3/3] Embedding and upserting products...')

  let upserted = 0
  let errors = 0
  const batch: Record<string, unknown>[] = []

  for (const product of shopifyProducts) {
    // Use the first (cheapest) in-stock variant, or the first variant
    const variant =
      product.variants.find(v => v.available) ?? product.variants[0]
    if (!variant) continue

    const price = parseFloat(variant.price)
    if (isNaN(price) || price < 0) continue

    const rawName = product.title
    const rawDesc = product.body_html ? stripHtml(product.body_html) : ''
    const cleanName = sanitizeProductText(rawName)
    const cleanDesc = rawDesc ? sanitizeProductText(rawDesc) : ''
    const imageUrl = product.images[0]?.src ?? null
    const productUrl = `${SHOP_URL}/products/${product.handle}`

    try {
      const embedInput = [businessName, cleanName, cleanDesc, !isNaN(price) ? `$${price}` : ''].filter(Boolean).join(' ')
      const embedding = await embedText(embedInput)

      batch.push({
        business_id: businessId,
        business_name: businessName,
        name: cleanName,
        description: cleanDesc || null,
        price,
        url: productUrl,
        image_url: imageUrl,
        sku: variant.sku || null,
        availability: variant.available ? 'in_stock' : 'out_of_stock',
        category_id: categoryId,
        status: 'active',
        embedding,
        last_seen: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      process.stdout.write(`  [${upserted + errors + 1}/${shopifyProducts.length}] ${cleanName}\r`)
    } catch (err) {
      console.error(`\n  Embed failed for "${rawName}":`, err)
      errors++
    }

    upserted++
  }

  // Upsert in a single batch (conflict on url)
  if (batch.length > 0) {
    const { error } = await db.from('products').upsert(batch, { onConflict: 'url' })
    if (error) {
      console.error('\nBatch upsert failed:', error.message)
      process.exit(1)
    }
  }

  console.log(`\n\nDone!`)
  console.log(`  Products upserted: ${batch.length}`)
  console.log(`  Embed errors:      ${errors}`)
  console.log(`  Business ID:       ${businessId}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
