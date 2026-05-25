/**
 * Seeds Silk and Teak Curated Collection as a business and imports all 157 products.
 * Usage: cd /path/to/main-street && npx ts-node --project tsconfig.json scripts/seed-silk-and-teak.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
config({ path: '.env.local' })

const SHOP_NAME = 'Silk and Teak Curated Collection'
const SHOP_URL = 'https://silkandteak.com/shop/silk-and-teak-curated-collection'
const TOWN = 'Burlington'

// Map Silk & Teak site categories → our DB category names
const CATEGORY_MAP: Record<string, string> = {
  'accessories': 'Clothing & Accessories',
  'bags & purses': 'Clothing & Accessories',
  'clothing': 'Clothing & Accessories',
  'jewelry': 'Gifts & Specialty',
  'home & living': 'Home & Garden',
  'weddings': 'Gifts & Specialty',
  'art & collectibles': 'Arts & Crafts',
}

interface ScrapedProduct {
  shop_name: string
  name: string
  description: string
  price: number
  url: string
  image_url: string
  availability: string
  category_name: string
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE env vars')

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Load scraped product data
  const productsPath = '/tmp/silk_teak_products.json'
  if (!fs.existsSync(productsPath)) {
    throw new Error(`Missing scraped data at ${productsPath}. Run the scraper first.`)
  }
  const scrapedProducts: ScrapedProduct[] = JSON.parse(fs.readFileSync(productsPath, 'utf8'))
  console.log(`Loaded ${scrapedProducts.length} scraped products`)

  // Fetch categories
  const { data: categories, error: catErr } = await db.from('categories').select('id, name')
  if (catErr) throw new Error(`Failed to fetch categories: ${catErr.message}`)
  const catByName: Record<string, string> = {}
  let otherCategoryId = ''
  for (const c of categories ?? []) {
    catByName[c.name.toLowerCase().trim()] = c.id
    if (c.name.toLowerCase() === 'other') otherCategoryId = c.id
  }
  const giftsSpecialtyCategoryId = catByName['gifts & specialty'] ?? otherCategoryId
  console.log('Categories loaded:', Object.keys(catByName))

  // Insert or find the business
  const { data: existing } = await db
    .from('businesses')
    .select('id, name')
    .ilike('url', SHOP_URL)
    .maybeSingle()

  let businessId: string
  if (existing) {
    businessId = existing.id
    console.log(`Business already exists: ${existing.name} (${businessId})`)
  } else {
    const { data: inserted, error: bizErr } = await db
      .from('businesses')
      .insert({
        name: SHOP_NAME,
        url: SHOP_URL,
        town: TOWN,
        category_id: giftsSpecialtyCategoryId || null,
        selectors: {},
        status: 'active',
        verification_status: 'verified',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (bizErr) throw new Error(`Failed to insert business: ${bizErr.message}`)
    businessId = inserted.id
    console.log(`Business created: ${SHOP_NAME} (${businessId})`)
  }

  // Check for already-imported products (by URL)
  const { data: existingProducts } = await db
    .from('products')
    .select('url')
    .eq('business_id', businessId)
  const existingUrls = new Set((existingProducts ?? []).map(p => p.url))
  console.log(`${existingUrls.size} products already in DB for this shop`)

  // Build product rows (deduplicate by URL)
  const toInsert = []
  let skipped = 0
  const seenProductUrls = new Set<string>()

  for (const p of scrapedProducts) {
    if (existingUrls.has(p.url) || seenProductUrls.has(p.url)) {
      skipped++
      continue
    }
    seenProductUrls.add(p.url)

    // Map category
    const siteCat = p.category_name.toLowerCase().trim()
    const mappedCat = CATEGORY_MAP[siteCat] ?? 'Gifts & Specialty'
    const categoryId = catByName[mappedCat.toLowerCase()] ?? otherCategoryId

    const VALID_AVAIL = ['in_stock', 'out_of_stock', 'limited', 'unknown']
    const availability = VALID_AVAIL.includes(p.availability) ? p.availability : 'unknown'

    toInsert.push({
      business_id: businessId,
      business_name: SHOP_NAME,
      name: p.name,
      description: p.description || null,
      price: p.price,
      image_url: p.image_url || null,
      image_urls: p.image_url ? [p.image_url] : [],
      availability,
      category_id: categoryId,
      url: p.url,
      status: 'active',
      updated_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    })
  }

  console.log(`Inserting ${toInsert.length} products (${skipped} already exist)...`)

  // Batch insert in chunks of 50
  let imported = 0
  const CHUNK = 50
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { data, error } = await db
      .from('products')
      .upsert(chunk, { onConflict: 'url', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error(`Error inserting chunk at ${i}: ${error.message}`)
      process.exit(1)
    }
    imported += data?.length ?? 0
    console.log(`  ${imported}/${toInsert.length} inserted`)
  }

  console.log(`\nDone!`)
  console.log(`  Business: ${SHOP_NAME} (${businessId})`)
  console.log(`  Products imported: ${imported}`)
  console.log(`  Products skipped (already existed): ${skipped}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
