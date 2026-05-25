// OpenAI-compatible message format (also matches Anthropic wire format for history storage)
export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; tool_use_id?: string }>
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
  last_seen: string
  similarity: number
}

export interface Business {
  id: string
  name: string
  url: string
  town: string
  selectors: Record<string, string>
  last_scraped: string | null
  product_count_baseline: number
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
