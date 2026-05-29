// Anthropic-shaped message format for conversation history storage.
// Old rows that stored plain strings still hydrate fine via the union below.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | Array<{ type: 'text'; text: string }>
      is_error?: boolean
    }

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ConversationRow {
  id: string
  messages: MessageParam[]
  last_search_results: ProductResult[] | null
  last_derived_query: string | null
  turn_count: number
  version: number
  session_fingerprint: string | null
  user_id: string | null
  expires_at: string
  created_at: string
}

export interface ProductResult {
  id: string
  business_id: string
  business_name: string
  name: string
  price: number
  url: string
  image_url: string | null
  image_urls: string[]
  last_seen: string
  similarity: number
}

export interface Business {
  id: string
  name: string
  url: string
  town: string
  selectors?: Record<string, string>
  last_scraped?: string | null
  product_count_baseline?: number
  category_id?: string | null
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  status?: 'active' | 'deactivated' | null
}

export interface ChatRequest {
  sessionId?: string
  message: string
}

export type ChatErrorCode =
  | 'turn_limit_exceeded'
  | 'session_expired'
  | 'session_not_found'
  | 'version_conflict'
  | 'fingerprint_mismatch'
  | 'internal_error'

export interface ChatErrorEvent {
  code: number
  type: ChatErrorCode
  message: string
  retry: boolean
}

export type ThreadType = 'recommendation' | 'order_update' | 'new_arrival' | 'availability'

export interface InboxThread {
  id: string
  customer_id: string
  subject: string
  thread_type: ThreadType
  messages: MessageParam[]
  opening_product: ProductResult | null
  read_at: string | null
  last_activity_at: string
  created_at: string
}

export interface PreferenceSignal {
  id: string
  customer_id: string
  user_id: string | null
  signal_type: 'viewed' | 'added_to_cart' | 'purchased' | 'dismissed'
  product_id: string | null
  product_name: string | null
  created_at: string
}

export interface User {
  id: string
  email: string
  name: string | null
  created_at: string
  updated_at: string
}

export interface SignupRequest {
  email: string
  password: string
  name?: string
}

export type UserRole = 'shopper' | 'admin'

export interface ScrapeDiff {
  added: number
  priceChanges: Array<{ name: string; oldPrice: number; newPrice: number }>
  removed: number
}

export type ScrapeStatus = 'never' | 'running' | 'success' | 'error' | 'cancelled'

export const STALE_THRESHOLD_DAYS = 7

export type Availability = 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'

export interface RawProduct {
  name: string
  price: number
  url: string
  imageUrls: string[]
  description?: string
  availability?: Availability
  stockStatus?: string
  sku?: string
}

export interface ProductEnrichment {
  productId: string
  category: string | null
  subcategory: string | null
  tags: string[]
  attributes: {
    color?: string
    material?: string
    size?: string
    style?: string
    occasion?: string
    [k: string]: string | undefined
  }
  visionDescription: string | null
  searchKeywords: string[]
  useCases: string[]
  targetCustomer: string | null
  giftFit: string | null
  brandVibe: string | null
  model: string
  enrichedAt: string
  sourceImageUrl: string | null
}

// --- Mason agent UI blocks --------------------------------------------------

export interface PlanStep {
  description: string
  tool?: string
}

export interface PlanData {
  goal: string
  steps: PlanStep[]
}

export interface QuestionData {
  question: string
  options?: string[]
}

export interface ProductStripData {
  headline?: string
  products: ProductResult[]
}

export interface ShopCardData {
  shop: Business
  reason?: string
}

export interface ArtifactChoiceItem {
  label: string
  description?: string
  image_url?: string
  value: string
}

export interface ArtifactData {
  kind: 'product_grid' | 'choice_picker'
  headline?: string
  products?: ProductResult[]
  question?: string
  choices?: ArtifactChoiceItem[]
}

export type Block =
  | { type: 'plan'; data: PlanData }
  | { type: 'question'; data: QuestionData }
  | { type: 'product_strip'; data: ProductStripData }
  | { type: 'shop_card'; data: ShopCardData }
  | { type: 'artifact'; data: ArtifactData }
