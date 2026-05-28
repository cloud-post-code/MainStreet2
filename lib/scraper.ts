import { chromium, type Browser, type Page } from 'playwright'
import { getSupabaseClient } from './supabase'
import { sanitizeProductText } from './scraper-sanitize'
import { enrichProduct, enrichmentToEmbedText } from './enrichment'
import type { ScrapeDiff, RawProduct, Availability } from './types'
export { STALE_THRESHOLD_DAYS, type RawProduct } from './types'

const DOMAIN_DELAY_MS = 2000
const NAV_TIMEOUT_MS = 30000
const MAX_PRODUCTS_PER_SHOP = 500
const MAX_COLLECTIONS = 12
const MAX_PAGES_PER_COLLECTION = 20

export type ScrapeMode = 'company' | 'products'

export interface ScrapeTarget {
  businessId: string
  businessName: string
  urls: string[]
  mode?: ScrapeMode
}

export interface ScrapeOptions {
  log?: (msg: string) => void
  signal?: AbortSignal
  enrich?: boolean
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

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

function isProductUrl(href: string): boolean {
  return /\/products?\//i.test(href) && !/\.(jpg|png|webp|gif|svg)(\?|$)/i.test(href)
}

function isCollectionUrl(href: string): boolean {
  return /\/(collections|shop|category|categories|catalog|store)\//i.test(href)
}

// ─── Discovery ──────────────────────────────────────────────────────────────

export async function discoverProductUrls(
  shopUrl: string,
  opts: ScrapeOptions = {},
): Promise<string[]> {
  const { log = () => {}, signal } = opts
  if (signal?.aborted) return []

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const onAbort = () => { browser.close().catch(() => {}) }
  signal?.addEventListener('abort', onAbort)

  const found = new Set<string>()

  try {
    log(`Discovering products from ${shopUrl}`)
    await page.goto(shopUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

    // Pull direct product links and collection links from the homepage
    const links = await page.$$eval('a[href]', els =>
      els.map(e => (e as HTMLAnchorElement).href).filter(Boolean),
    )

    const collectionUrls = new Set<string>()
    for (const href of links) {
      if (!sameOrigin(href, shopUrl)) continue
      if (isProductUrl(href)) {
        found.add(href.split('#')[0])
      } else if (isCollectionUrl(href)) {
        collectionUrls.add(href.split('#')[0].split('?')[0])
      }
      if (found.size >= MAX_PRODUCTS_PER_SHOP) break
    }
    log(`Found ${collectionUrls.size} collections, ${found.size} product links on homepage`)

    // If no collections, try common Shopify fallbacks
    if (collectionUrls.size === 0) {
      const base = new URL(shopUrl).origin
      collectionUrls.add(`${base}/collections/all`)
      collectionUrls.add(`${base}/shop`)
    }

    const collections = Array.from(collectionUrls).slice(0, MAX_COLLECTIONS)
    for (const colUrl of collections) {
      if (signal?.aborted) break
      if (found.size >= MAX_PRODUCTS_PER_SHOP) break

      for (let pageNum = 1; pageNum <= MAX_PAGES_PER_COLLECTION; pageNum++) {
        if (signal?.aborted) break
        if (found.size >= MAX_PRODUCTS_PER_SHOP) break

        const url = pageNum === 1 ? colUrl : `${colUrl}?page=${pageNum}`
        let loaded = false
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
          loaded = !!resp && resp.status() < 400
        } catch {
          break
        }
        if (!loaded) break

        const before = found.size
        const pageLinks = await page.$$eval('a[href]', els =>
          els.map(e => (e as HTMLAnchorElement).href).filter(Boolean),
        )
        for (const href of pageLinks) {
          if (!sameOrigin(href, shopUrl)) continue
          if (isProductUrl(href)) found.add(href.split('#')[0])
          if (found.size >= MAX_PRODUCTS_PER_SHOP) break
        }
        const added = found.size - before
        if (pageNum > 1 && added === 0) break // no more results
        await new Promise(r => setTimeout(r, 300))
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await browser.close().catch(() => {})
  }

  const list = Array.from(found).slice(0, MAX_PRODUCTS_PER_SHOP)
  log(`Discovery complete: ${list.length} product URLs`)
  return list
}

// ─── Product detail ─────────────────────────────────────────────────────────

interface DetailExtract {
  name: string
  price: number | null
  imageUrls: string[]
  description: string
  availability: Availability
  stockStatus: string | null
  sku: string | null
}

async function extractDetailFromPage(page: Page): Promise<DetailExtract> {
  return page.evaluate(() => {
    const out: {
      name: string
      price: number | null
      imageUrls: string[]
      description: string
      availability: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'
      stockStatus: string | null
      sku: string | null
    } = {
      name: '',
      price: null,
      imageUrls: [],
      description: '',
      availability: 'unknown',
      stockStatus: null,
      sku: null,
    }

    // 1. JSON-LD Product schema — most reliable source
    const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const node of ldNodes) {
      try {
        const raw = JSON.parse(node.textContent ?? 'null')
        const candidates = Array.isArray(raw) ? raw : raw && raw['@graph'] ? raw['@graph'] : [raw]
        for (const item of candidates) {
          if (!item || typeof item !== 'object') continue
          if (item['@type'] !== 'Product' && !(Array.isArray(item['@type']) && item['@type'].includes('Product'))) continue
          if (!out.name && typeof item.name === 'string') out.name = item.name
          if (!out.description && typeof item.description === 'string') out.description = item.description
          if (!out.sku && typeof item.sku === 'string') out.sku = item.sku
          const imgs = Array.isArray(item.image) ? item.image : item.image ? [item.image] : []
          for (const img of imgs) {
            if (typeof img === 'string') out.imageUrls.push(img)
            else if (img && typeof img === 'object' && typeof img.url === 'string') out.imageUrls.push(img.url)
          }
          const offers = Array.isArray(item.offers) ? item.offers : item.offers ? [item.offers] : []
          for (const offer of offers) {
            if (!offer || typeof offer !== 'object') continue
            if (out.price == null) {
              const p = offer.price ?? offer.lowPrice
              const n = typeof p === 'number' ? p : parseFloat(String(p ?? ''))
              if (!isNaN(n) && n > 0) out.price = n
            }
            const avail = String(offer.availability ?? '').toLowerCase()
            if (avail.includes('instock')) out.availability = 'in_stock'
            else if (avail.includes('outofstock') || avail.includes('soldout')) out.availability = 'out_of_stock'
            else if (avail.includes('limited') || avail.includes('lowstock')) out.availability = 'limited'
          }
        }
      } catch { /* ignore malformed ld+json */ }
    }

    // 2. Shopify embedded product JSON fallback
    if (out.price == null || out.availability === 'unknown') {
      const scripts = Array.from(document.querySelectorAll('script'))
      for (const s of scripts) {
        const txt = s.textContent ?? ''
        const m = txt.match(/"variants":\s*(\[[^\]]*\])/)
        if (!m) continue
        try {
          const variants = JSON.parse(m[1]) as Array<{ price?: string | number; available?: boolean; sku?: string }>
          const firstAvail = variants.find(v => v.available) ?? variants[0]
          if (firstAvail) {
            if (out.price == null && firstAvail.price != null) {
              const raw = typeof firstAvail.price === 'number' ? firstAvail.price : parseFloat(String(firstAvail.price))
              if (!isNaN(raw)) out.price = raw > 1000 ? raw / 100 : raw  // Shopify cents
            }
            if (out.availability === 'unknown') {
              out.availability = variants.some(v => v.available) ? 'in_stock' : 'out_of_stock'
            }
            if (!out.sku && firstAvail.sku) out.sku = firstAvail.sku
            break
          }
        } catch { /* ignore */ }
      }
    }

    // 3. DOM fallbacks
    if (!out.name) {
      out.name = document.querySelector('h1')?.textContent?.trim()
        ?? document.querySelector('[class*="product-title"], [class*="ProductTitle"]')?.textContent?.trim()
        ?? document.title
    }
    if (out.price == null) {
      const priceEl = document.querySelector('meta[itemprop="price"], meta[property="product:price:amount"]') as HTMLMetaElement | null
      if (priceEl?.content) {
        const n = parseFloat(priceEl.content)
        if (!isNaN(n) && n > 0) out.price = n
      }
    }
    if (out.price == null) {
      const txt = document.querySelector('[class*="price"]:not([class*="compare"])')?.textContent ?? ''
      const m = txt.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/)
      if (m) {
        const n = parseFloat(m[1])
        if (!isNaN(n) && n > 0) out.price = n
      }
    }
    if (out.imageUrls.length === 0) {
      const og = (document.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content
      if (og) out.imageUrls.push(og)
      const galleryImgs = Array.from(document.querySelectorAll<HTMLImageElement>('[class*="product-image"] img, [class*="gallery"] img, [class*="ProductImage"] img'))
      for (const img of galleryImgs) {
        const src = img.src || img.getAttribute('data-src') || ''
        if (src) out.imageUrls.push(src)
      }
    }
    if (!out.description) {
      out.description = document.querySelector('[class*="product-description"], [class*="ProductDescription"]')?.textContent?.trim()
        ?? (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content
        ?? ''
    }

    // 4. Availability via button text fallback
    if (out.availability === 'unknown') {
      const btn = (document.querySelector('[class*="add-to-cart"], [name*="add"], button[type="submit"]')?.textContent ?? '').toLowerCase()
      if (btn.includes('sold out') || btn.includes('out of stock')) out.availability = 'out_of_stock'
      else if (btn.includes('add to cart') || btn.includes('buy now')) out.availability = 'in_stock'
    }
    const stockEl = document.querySelector('[class*="stock-status"], [class*="StockStatus"], [class*="inventory"]')
    if (stockEl?.textContent) out.stockStatus = stockEl.textContent.trim().slice(0, 120)

    out.imageUrls = Array.from(new Set(out.imageUrls)).filter(u => !!u && /^https?:/.test(u))
    return out
  })
}

export async function scrapeProductDetail(
  productUrl: string,
  opts: ScrapeOptions = {},
  sharedBrowser?: Browser,
): Promise<RawProduct | null> {
  const { log = () => {}, signal } = opts
  if (signal?.aborted) return null

  const browser = sharedBrowser ?? await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    const d = await extractDetailFromPage(page)
    if (!d.name || d.price == null || d.price <= 0) {
      log(`SKIP ${productUrl} (name=${!!d.name} price=${d.price})`)
      return null
    }
    return {
      name: d.name,
      price: d.price,
      url: productUrl,
      imageUrls: d.imageUrls,
      description: d.description || undefined,
      availability: d.availability,
      stockStatus: d.stockStatus ?? undefined,
      sku: d.sku ?? undefined,
    }
  } catch (err) {
    log(`detail error ${productUrl}: ${err}`)
    return null
  } finally {
    await page.close().catch(() => {})
    if (!sharedBrowser) await browser.close().catch(() => {})
  }
}

// ─── Back-compat: scrapeShopPage now = discover + detail ─────────────────────

export async function scrapeShopPage(url: string, opts: ScrapeOptions = {}): Promise<RawProduct[]> {
  const productUrls = await discoverProductUrls(url, opts)
  const browser = await chromium.launch({ headless: true })
  const out: RawProduct[] = []
  try {
    for (const pu of productUrls) {
      if (opts.signal?.aborted) break
      const p = await scrapeProductDetail(pu, opts, browser)
      if (p) out.push(p)
      await new Promise(r => setTimeout(r, 500))
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return out
}

// ─── End-to-end pipeline ────────────────────────────────────────────────────

export async function scrapeAndUpsert(
  target: ScrapeTarget,
  opts: ScrapeOptions = {},
): Promise<{ upserted: number; errors: number; enriched: number; diff: ScrapeDiff }> {
  const { log = () => {}, signal, enrich = true } = opts
  const mode: ScrapeMode = target.mode ?? 'company'
  const supabase = getSupabaseClient()
  let upserted = 0
  let errors = 0
  let enriched = 0
  const diff: ScrapeDiff = { added: 0, priceChanges: [], removed: 0 }

  const { count: before } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', target.businessId)

  const { data: existingProducts } = await supabase
    .from('products')
    .select('url, name, price, product_field_overrides(field_name)')
    .eq('business_id', target.businessId)

  const priceByUrl = new Map<string, { name: string; price: number }>()
  const lockedByUrl = new Map<string, Set<string>>()
  for (const p of (existingProducts ?? [])) {
    priceByUrl.set(p.url, { name: p.name, price: Number(p.price) })
    const locked = new Set<string>(
      ((p as { product_field_overrides?: Array<{ field_name: string }> }).product_field_overrides ?? [])
        .map(o => o.field_name)
    )
    if (locked.size > 0) lockedByUrl.set(p.url, locked)
  }

  // Resolve list of product URLs depending on mode
  const productUrls: string[] = []
  if (mode === 'products') {
    productUrls.push(...target.urls)
  } else {
    for (const shopUrl of target.urls) {
      if (signal?.aborted) break
      try {
        const discovered = await discoverProductUrls(shopUrl, opts)
        productUrls.push(...discovered)
        log(`Discovered ${discovered.length} products under ${shopUrl}`)
      } catch (err) {
        log(`ERROR: discovery failed for ${shopUrl}: ${err}`)
        errors++
      }
      await new Promise(r => setTimeout(r, DOMAIN_DELAY_MS))
    }
  }

  const deduped = Array.from(new Set(productUrls)).slice(0, MAX_PRODUCTS_PER_SHOP)
  log(`Scraping ${deduped.length} product detail pages (mode=${mode})`)

  // Reuse one Playwright browser across detail fetches
  const browser = await chromium.launch({ headless: true })
  try {
    for (const pdpUrl of deduped) {
      if (signal?.aborted) break
      await new Promise(r => setTimeout(r, DOMAIN_DELAY_MS / 4))

      let product: RawProduct | null
      try {
        product = await scrapeProductDetail(pdpUrl, opts, browser)
      } catch (err) {
        log(`ERROR: detail failed for ${pdpUrl}: ${err}`)
        errors++
        continue
      }
      if (!product) continue

      try {
        const cleanName = sanitizeProductText(product.name)
        const cleanDesc = product.description ? sanitizeProductText(product.description) : ''
        const baseEmbedInput = [
          target.businessName,
          cleanName,
          cleanDesc,
          product.price != null ? `$${product.price}` : '',
        ].filter(Boolean).join(' ')

        const existing = priceByUrl.get(product.url)
        if (!existing) {
          diff.added++
          log(`+ new: ${cleanName} $${product.price}`)
        } else if (Math.abs(existing.price - product.price) > 0.01) {
          diff.priceChanges.push({ name: cleanName, oldPrice: existing.price, newPrice: product.price })
          log(`~ price: ${cleanName} $${existing.price} → $${product.price}`)
        }

        const primaryImage = product.imageUrls[0] ?? null
        const embedding = await embedText(baseEmbedInput)

        const locked = lockedByUrl.get(product.url) ?? new Set<string>()
        const upsertPayload: Record<string, unknown> = {
          business_id: target.businessId,
          business_name: target.businessName,
          name: cleanName,
          description: cleanDesc || null,
          url: product.url,
          image_url: primaryImage,
          sku: product.sku ?? null,
          embedding,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (!locked.has('price')) upsertPayload.price = product.price
        if (!locked.has('availability')) upsertPayload.availability = product.availability ?? 'unknown'
        if (!locked.has('stock_status')) upsertPayload.stock_status = product.stockStatus ?? null

        const { data: upsertedRow, error: upsertErr } = await supabase.from('products').upsert(
          upsertPayload,
          { onConflict: 'url' },
        ).select('id').single()

        if (upsertErr || !upsertedRow) {
          log(`ERROR: upsert failed for ${product.url}: ${upsertErr?.message}`)
          errors++
          continue
        }

        if (product.imageUrls.length > 0) {
          await supabase.from('product_images').delete().eq('product_id', upsertedRow.id)
          await supabase.from('product_images').insert(
            product.imageUrls.map((imgUrl, idx) => ({
              product_id: upsertedRow.id,
              image_url: imgUrl,
              display_order: idx,
            })),
          )
        }

        upserted++

        // Vision enrichment + embedding refresh that incorporates the mapped listing
        if (enrich && primaryImage) {
          const ok = await enrichProduct({
            productId: upsertedRow.id,
            businessName: target.businessName,
            name: cleanName,
            price: product.price,
            description: cleanDesc,
            imageUrl: primaryImage,
          })
          if (ok) {
            enriched++
            const { data: enrichmentRow } = await supabase
              .from('product_enrichment')
              .select('category, subcategory, tags, vision_description, search_keywords')
              .eq('product_id', upsertedRow.id)
              .single()
            if (enrichmentRow) {
              const extra = enrichmentToEmbedText(enrichmentRow)
              if (extra) {
                const richEmbedding = await embedText(`${baseEmbedInput} ${extra}`)
                await supabase.from('products')
                  .update({ embedding: richEmbedding })
                  .eq('id', upsertedRow.id)
              }
            }
          }
        }
      } catch (err) {
        log(`ERROR: embed/upsert failed for ${product.url}: ${err}`)
        errors++
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  const { count: after } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', target.businessId)

  if (before && after && after < before * 0.6) {
    log(`WARNING: product count dropped from ${before} to ${after}`)
  }
  diff.removed = Math.max(0, (before ?? 0) - (after ?? 0))
  return { upserted, errors, enriched, diff }
}
