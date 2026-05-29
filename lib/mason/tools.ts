import { searchProducts, getProductsByIds } from '../search'
import { searchShops, getShopById } from '../shops'
import { getCustomerLongTermContext, recordPreferenceSignal } from '../memory'
import { getSupabaseClient } from '../supabase'
import type { Emit } from './blocks'
import type { ProductResult } from '../types'

export interface ToolContext {
  customerId: string
  isAuthenticated: boolean
  emit: Emit
}

interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

// --- plan -------------------------------------------------------------------

const planTool: ToolDef = {
  name: 'plan',
  description:
    'Lay out a brief plan before doing anything non-trivial. Emits a visible plan block so the customer sees how you intend to help. Use 2-4 short steps.',
  input_schema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'One short sentence: what is the customer trying to accomplish?' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            tool: { type: 'string', description: 'Optional: which tool you intend to use for this step.' },
          },
          required: ['description'],
        },
      },
    },
    required: ['goal', 'steps'],
  },
  async execute(input, ctx) {
    const goal = String(input.goal ?? '')
    const steps = Array.isArray(input.steps) ? input.steps as Array<{ description: string; tool?: string }> : []
    ctx.emit({ event: 'block', data: { id: (globalThis.crypto as Crypto).randomUUID(), type: 'plan', data: { goal, steps } } })
    return { ok: true, goal, steps }
  },
}

// --- search_products --------------------------------------------------------

const searchProductsTool: ToolDef = {
  name: 'search_products',
  description:
    'Semantic search over the Main Street product catalog. Returns matched products with shop, price, image, and similarity score. Call this whenever you need candidate products. Use specific queries — describe what the customer wants, not generic terms.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language description of what to find. Include context (occasion, recipient, style) when useful.' },
      limit: { type: 'number', description: 'Max results (default 5, prefer 4-8).' },
      min_price: { type: 'number' },
      max_price: { type: 'number' },
      business_id: { type: 'string', description: 'Restrict to a single shop by id.' },
    },
    required: ['query'],
  },
  async execute(input) {
    const products = await searchProducts(String(input.query ?? ''), {
      limit: typeof input.limit === 'number' ? input.limit : undefined,
      min_price: typeof input.min_price === 'number' ? input.min_price : undefined,
      max_price: typeof input.max_price === 'number' ? input.max_price : undefined,
      business_id: typeof input.business_id === 'string' ? input.business_id : undefined,
    })
    return {
      count: products.length,
      products: products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        shop: p.business_name,
        business_id: p.business_id,
        url: p.url,
        similarity: Number(p.similarity?.toFixed(3) ?? 0),
      })),
    }
  },
}

// --- search_shops -----------------------------------------------------------

const searchShopsTool: ToolDef = {
  name: 'search_shops',
  description:
    'Find local shops (businesses) by name, town, or category. Use when the customer asks about a shop, wants to browse by store, or needs hours/address.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Partial shop name match.' },
      town: { type: 'string' },
      category_id: { type: 'string' },
      limit: { type: 'number' },
    },
  },
  async execute(input) {
    const shops = await searchShops({
      query: typeof input.query === 'string' ? input.query : undefined,
      town: typeof input.town === 'string' ? input.town : undefined,
      category_id: typeof input.category_id === 'string' ? input.category_id : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    })
    return {
      count: shops.length,
      shops: shops.map(s => ({
        id: s.id,
        name: s.name,
        town: s.town,
        url: s.url,
        address: [s.address_street, s.address_city, s.address_state, s.address_zip].filter(Boolean).join(', ') || null,
      })),
    }
  },
}

// --- get_product_details ----------------------------------------------------

const getProductDetailsTool: ToolDef = {
  name: 'get_product_details',
  description: 'Fetch full details for a product by id, including all images.',
  input_schema: {
    type: 'object',
    properties: { product_id: { type: 'string' } },
    required: ['product_id'],
  },
  async execute(input) {
    const id = String(input.product_id ?? '')
    const [product] = await getProductsByIds([id])
    if (!product) return { error: 'not_found' }
    return product
  },
}

// --- get_shop_details -------------------------------------------------------

const getShopDetailsTool: ToolDef = {
  name: 'get_shop_details',
  description: 'Fetch full details for a shop by id (address, contact, status). Use when the customer wants to visit or contact a specific store.',
  input_schema: {
    type: 'object',
    properties: { shop_id: { type: 'string' } },
    required: ['shop_id'],
  },
  async execute(input) {
    const shop = await getShopById(String(input.shop_id ?? ''))
    if (!shop) return { error: 'not_found' }
    return {
      id: shop.id,
      name: shop.name,
      town: shop.town,
      url: shop.url,
      address: {
        street: shop.address_street ?? null,
        city: shop.address_city ?? null,
        state: shop.address_state ?? null,
        zip: shop.address_zip ?? null,
      },
      contact: {
        name: shop.contact_name ?? null,
        email: shop.contact_email ?? null,
        phone: shop.contact_phone ?? null,
      },
    }
  },
}

// --- recall_customer_context ------------------------------------------------

const recallCustomerContextTool: ToolDef = {
  name: 'recall_customer_context',
  description:
    "Recall this customer's long-term context: recent orders, preference signals (viewed/dismissed/purchased), and past search topics. Call this once, early in the turn, when the customer's request is open-ended or you want to personalize.",
  input_schema: {
    type: 'object',
    properties: {},
  },
  async execute(_input, ctx) {
    const ctx2 = await getCustomerLongTermContext(ctx.customerId, ctx.isAuthenticated)
    return {
      is_authenticated: ctx2.is_authenticated,
      recent_orders: ctx2.recent_orders.map(o => ({
        id: o.id,
        status: o.status,
        total_cents: o.total_cents,
        created_at: o.created_at,
      })),
      preferences_summary: summarizePreferences(ctx2.recent_preferences),
      recent_search_topics: ctx2.recent_searches.map(s => s.derived_query).filter(Boolean).slice(0, 5),
    }
  },
}

function summarizePreferences(prefs: Array<{ signal_type: string; product_name: string | null }>) {
  const byType: Record<string, string[]> = {}
  for (const p of prefs) {
    if (!p.product_name) continue
    byType[p.signal_type] ??= []
    if (byType[p.signal_type].length < 5) byType[p.signal_type].push(p.product_name)
  }
  return byType
}

// --- record_preference ------------------------------------------------------

const recordPreferenceTool: ToolDef = {
  name: 'record_preference',
  description:
    "Log a preference signal so future sessions improve. Call this when the customer reacts to a product (likes it, dismisses it, or you suspect they're interested).",
  input_schema: {
    type: 'object',
    properties: {
      product_id: { type: 'string' },
      signal: { type: 'string', enum: ['viewed', 'added_to_cart', 'purchased', 'dismissed'] },
    },
    required: ['product_id', 'signal'],
  },
  async execute(input, ctx) {
    const productId = String(input.product_id ?? '')
    const signal = String(input.signal ?? 'viewed') as 'viewed' | 'added_to_cart' | 'purchased' | 'dismissed'
    if (!productId) return { error: 'product_id required' }
    await recordPreferenceSignal({
      customerId: ctx.customerId,
      isAuthenticated: ctx.isAuthenticated,
      productId,
      signalType: signal,
    })
    return { ok: true }
  },
}

// --- build_artifact (UI emission) -------------------------------------------

const buildArtifactTool: ToolDef = {
  name: 'build_artifact',
  description:
    'Build a rich UI artifact for the customer. Use kind="product_grid" to show 1-4 curated product cards (NEVER more than 4 — pick the best matches only). Use kind="choice_picker" to ask a visual question — e.g. pick a style, theme, occasion, or price range — with 2-4 labeled choices and optional images. Use choice_picker instead of a plain text question whenever a visual/contextual choice helps narrow things down. Never ask more than twice per conversation.',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['product_grid', 'choice_picker'],
        description: 'product_grid: show 1-4 product cards. choice_picker: interactive visual question with 2-4 choices.',
      },
      headline: { type: 'string', description: 'Short heading shown above the artifact.' },
      product_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required for product_grid. 1-4 product ids from prior search results.',
      },
      question: { type: 'string', description: 'Required for choice_picker. The question to ask.' },
      choices: {
        type: 'array',
        description: 'Required for choice_picker. 2-4 choices.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            image_url: { type: 'string', description: 'Optional image URL to illustrate this choice.' },
            value: { type: 'string', description: 'The text sent back when customer picks this choice.' },
          },
          required: ['label', 'value'],
        },
      },
    },
    required: ['kind'],
  },
  async execute(input, ctx) {
    const kind = String(input.kind ?? '') as 'product_grid' | 'choice_picker'

    if (kind === 'product_grid') {
      const ids = Array.isArray(input.product_ids) ? input.product_ids.map(String).slice(0, 4) : []
      if (ids.length === 0) return { error: 'product_ids required for product_grid' }
      const products = await getProductsByIds(ids)
      if (products.length === 0) return { error: 'no products matched ids', requested: ids }
      const headline = typeof input.headline === 'string' ? input.headline : undefined
      ctx.emit({
        event: 'block',
        data: {
          id: (globalThis.crypto as Crypto).randomUUID(),
          type: 'artifact',
          data: { kind: 'product_grid', headline, products },
        },
      })
      return { ok: true, shown: products.length }
    }

    if (kind === 'choice_picker') {
      const question = typeof input.question === 'string' ? input.question : ''
      const rawChoices = Array.isArray(input.choices) ? input.choices : []
      if (rawChoices.length < 2) return { error: 'choice_picker requires at least 2 choices' }
      const choices = rawChoices.slice(0, 4).map((c: Record<string, unknown>) => ({
        label: String(c.label ?? ''),
        description: typeof c.description === 'string' ? c.description : undefined,
        image_url: typeof c.image_url === 'string' && /^https?:\/\//.test(c.image_url) ? c.image_url : undefined,
        value: String(c.value ?? c.label ?? ''),
      }))
      const headline = typeof input.headline === 'string' ? input.headline : undefined
      ctx.emit({
        event: 'block',
        data: {
          id: (globalThis.crypto as Crypto).randomUUID(),
          type: 'artifact',
          data: { kind: 'choice_picker', headline, question, choices },
        },
      })
      return { ok: true }
    }

    return { error: `unknown artifact kind: ${kind}` }
  },
}

// --- show_products (kept for in-flight sessions — not in TOOL_DEFINITIONS) --

const showProductsTool: ToolDef = {
  name: 'show_products',
  description: 'Legacy — not exposed to agent. Kept so in-flight sessions that call show_products still resolve.',
  input_schema: {
    type: 'object',
    properties: {
      product_ids: { type: 'array', items: { type: 'string' } },
      headline: { type: 'string' },
    },
    required: ['product_ids'],
  },
  async execute(input, ctx) {
    const ids = Array.isArray(input.product_ids) ? input.product_ids.map(String).slice(0, 4) : []
    if (ids.length === 0) return { error: 'product_ids required' }
    const products = await getProductsByIds(ids)
    if (products.length === 0) return { error: 'no products matched ids', requested: ids }
    const headline = typeof input.headline === 'string' ? input.headline : undefined
    ctx.emit({
      event: 'block',
      data: {
        id: (globalThis.crypto as Crypto).randomUUID(),
        type: 'artifact',
        data: { kind: 'product_grid', headline, products },
      },
    })
    return { ok: true, shown: products.length }
  },
}

// --- show_shop (UI emission) ------------------------------------------------

const showShopTool: ToolDef = {
  name: 'show_shop',
  description: 'Render a shop card with name, town, address, and a short reason. Use when recommending a specific shop or answering "where do I find X".',
  input_schema: {
    type: 'object',
    properties: {
      shop_id: { type: 'string' },
      reason: { type: 'string', description: 'One short sentence: why this shop fits.' },
    },
    required: ['shop_id'],
  },
  async execute(input, ctx) {
    const shop = await getShopById(String(input.shop_id ?? ''))
    if (!shop) return { error: 'shop not found' }
    const reason = typeof input.reason === 'string' ? input.reason : undefined
    ctx.emit({
      event: 'block',
      data: { id: (globalThis.crypto as Crypto).randomUUID(), type: 'shop_card', data: { shop, reason } },
    })
    return { ok: true, shop_id: shop.id }
  },
}

// --- ask_question (UI emission) ---------------------------------------------

const askQuestionTool: ToolDef = {
  name: 'ask_question',
  description:
    "Ask the customer ONE focused clarifying question. Provide 3-4 chip options when possible (tappable shortcuts). Don't ask more than twice per conversation; prefer showing products.",
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, description: '3-4 short tappable suggestions.' },
    },
    required: ['question'],
  },
  async execute(input, ctx) {
    const question = String(input.question ?? '')
    const options = Array.isArray(input.options) ? input.options.map(String).slice(0, 6) : undefined
    ctx.emit({
      event: 'block',
      data: { id: (globalThis.crypto as Crypto).randomUUID(), type: 'question', data: { question, options } },
    })
    return { ok: true }
  },
}

// --- registry ---------------------------------------------------------------

// Tools exposed to the agent via TOOL_DEFINITIONS
const AGENT_TOOLS: ToolDef[] = [
  planTool,
  recallCustomerContextTool,
  searchProductsTool,
  searchShopsTool,
  getProductDetailsTool,
  getShopDetailsTool,
  buildArtifactTool,
  showShopTool,
  askQuestionTool,
  recordPreferenceTool,
]

// showProductsTool is excluded from AGENT_TOOLS (agent never sees it) but kept
// in ALL_TOOLS so in-flight sessions that call show_products still resolve.
const ALL_TOOLS: ToolDef[] = [...AGENT_TOOLS, showProductsTool]

export const TOOL_DEFINITIONS = AGENT_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}))

const TOOL_BY_NAME = new Map(ALL_TOOLS.map(t => [t.name, t]))

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) return { error: `unknown tool: ${name}` }
  return tool.execute(input, ctx)
}

// Convenience export so the agent loop doesn't have to import getSupabaseClient elsewhere.
export { getSupabaseClient }
// And ProductResult for type reuse.
export type { ProductResult }
