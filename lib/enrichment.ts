import { getSupabaseClient } from './supabase'
import { sanitizeProductText } from './scraper-sanitize'

const ENRICHMENT_MODEL = 'gpt-4o-mini'

export interface EnrichInput {
  productId: string
  businessName: string
  name: string
  price: number
  description?: string | null
  imageUrl: string | null
}

interface RawEnrichment {
  category?: unknown
  subcategory?: unknown
  tags?: unknown
  attributes?: unknown
  vision_description?: unknown
  search_keywords?: unknown
  use_cases?: unknown
  target_customer?: unknown
  gift_fit?: unknown
  brand_vibe?: unknown
}

const SYSTEM_PROMPT = `You are a catalog enrichment specialist. Look at the product image and the provided text, then produce a structured listing.

Return ONLY a JSON object with these keys (no prose, no markdown):
{
  "category": string,              // top-level category (e.g. "Home & Garden", "Apparel", "Food & Beverage")
  "subcategory": string,           // narrower category (e.g. "Throw Pillows", "Tea")
  "tags": string[],                // 5-12 short descriptive tags
  "attributes": {                  // include keys only if visible/known
    "color": string,
    "material": string,
    "size": string,
    "style": string,
    "occasion": string
  },
  "vision_description": string,    // 1-3 sentences describing what you actually see in the image
  "search_keywords": string[],     // 8-15 phrases a shopper might type to find this
  "use_cases": string[],           // 3-6 short phrases ("morning coffee", "hostess gift")
  "target_customer": string,       // one short phrase
  "gift_fit": string,              // one short phrase ("good for a foodie friend")
  "brand_vibe": string             // one short phrase ("rustic artisan", "minimalist modern")
}

Rules:
- Trust the image over the text when they disagree.
- If a field is genuinely unknown, omit it (do not invent).
- Keep every string under 120 chars.`

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 240) : null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(s => s.trim().slice(0, 120))
    .slice(0, 20)
}

function asAttributes(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) {
      out[k.slice(0, 40)] = raw.trim().slice(0, 120)
    }
  }
  return out
}

export async function enrichProduct(input: EnrichInput): Promise<boolean> {
  if (!input.imageUrl) return false
  if (!process.env.OPENAI_API_KEY) {
    console.warn('enrichProduct: OPENAI_API_KEY missing, skipping')
    return false
  }

  const ctxText = [
    `Business: ${sanitizeProductText(input.businessName)}`,
    `Product name: ${sanitizeProductText(input.name)}`,
    `Price: $${input.price.toFixed(2)}`,
    input.description ? `Scraped description: ${sanitizeProductText(input.description).slice(0, 800)}` : '',
  ].filter(Boolean).join('\n')

  let resp: Response
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ENRICHMENT_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: ctxText },
              { type: 'image_url', image_url: { url: input.imageUrl, detail: 'low' } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    console.warn(`enrichProduct: network error for ${input.productId}: ${err}`)
    return false
  }

  if (!resp.ok) {
    console.warn(`enrichProduct: HTTP ${resp.status} for ${input.productId}`)
    return false
  }

  let parsed: RawEnrichment
  try {
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content ?? '{}'
    parsed = JSON.parse(content) as RawEnrichment
  } catch (err) {
    console.warn(`enrichProduct: bad JSON for ${input.productId}: ${err}`)
    return false
  }

  const row = {
    product_id: input.productId,
    category: asString(parsed.category),
    subcategory: asString(parsed.subcategory),
    tags: asStringArray(parsed.tags),
    attributes: asAttributes(parsed.attributes),
    vision_description: asString(parsed.vision_description),
    search_keywords: asStringArray(parsed.search_keywords),
    use_cases: asStringArray(parsed.use_cases),
    target_customer: asString(parsed.target_customer),
    gift_fit: asString(parsed.gift_fit),
    brand_vibe: asString(parsed.brand_vibe),
    model: ENRICHMENT_MODEL,
    enriched_at: new Date().toISOString(),
    source_image_url: input.imageUrl,
  }

  const supabase = getSupabaseClient()
  const { error } = await supabase.from('product_enrichment').upsert(row, { onConflict: 'product_id' })
  if (error) {
    console.warn(`enrichProduct: upsert failed for ${input.productId}: ${error.message}`)
    return false
  }
  return true
}

export function enrichmentToEmbedText(e: {
  category?: string | null
  subcategory?: string | null
  tags?: string[] | null
  vision_description?: string | null
  search_keywords?: string[] | null
}): string {
  return [
    e.category,
    e.subcategory,
    (e.tags ?? []).join(' '),
    e.vision_description,
    (e.search_keywords ?? []).join(' '),
  ].filter(Boolean).join(' ').trim()
}
