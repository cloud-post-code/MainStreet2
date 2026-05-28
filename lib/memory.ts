import { getSupabaseClient } from './supabase'
import type { ProductResult } from './types'

export interface RecentOrderSummary {
  id: string
  status: string
  total_cents: number | null
  items: unknown
  created_at: string
}

export interface PreferenceSummary {
  signal_type: 'viewed' | 'added_to_cart' | 'purchased' | 'dismissed'
  product_id: string | null
  product_name: string | null
  created_at: string
}

export interface RecentSearchSummary {
  id: string
  derived_query: string | null
  last_search_results: ProductResult[] | null
  created_at: string
}

export interface CustomerLongTermContext {
  is_authenticated: boolean
  recent_orders: RecentOrderSummary[]
  recent_preferences: PreferenceSummary[]
  recent_searches: RecentSearchSummary[]
}

export async function getCustomerLongTermContext(
  customerId: string,
  isAuthenticated: boolean,
): Promise<CustomerLongTermContext> {
  const supabase = getSupabaseClient()

  // Orders only exist for authenticated users (or matched by user_id FK).
  const ordersPromise = isAuthenticated
    ? supabase
        .from('orders')
        .select('id, status, total_cents, items, created_at')
        .eq('user_id', customerId)
        .order('created_at', { ascending: false })
        .limit(10)
    : Promise.resolve({ data: [], error: null })

  // Preference signals: scoped by user_id when auth, customer_id (fingerprint or text id) otherwise.
  const prefBuilder = supabase
    .from('customer_preference_signals')
    .select('signal_type, product_id, product_name, created_at')
    .order('created_at', { ascending: false })
    .limit(30)
  const prefsPromise = isAuthenticated
    ? prefBuilder.eq('user_id', customerId)
    : prefBuilder.eq('customer_id', customerId)

  // Past conversations — pull a short window of context-rich rows.
  const convoBuilder = supabase
    .from('conversations')
    .select('id, last_derived_query, last_search_results, created_at')
    .order('created_at', { ascending: false })
    .limit(5)
  const convosPromise = isAuthenticated
    ? convoBuilder.eq('user_id', customerId)
    : convoBuilder.eq('session_fingerprint', customerId)

  const [ordersRes, prefsRes, convosRes] = await Promise.all([
    ordersPromise,
    prefsPromise,
    convosPromise,
  ])

  return {
    is_authenticated: isAuthenticated,
    recent_orders: (ordersRes.data ?? []) as RecentOrderSummary[],
    recent_preferences: (prefsRes.data ?? []) as PreferenceSummary[],
    recent_searches: ((convosRes.data ?? []) as Array<{ id: string; last_derived_query: string | null; last_search_results: ProductResult[] | null; created_at: string }>).map(r => ({
      id: r.id,
      derived_query: r.last_derived_query,
      last_search_results: r.last_search_results,
      created_at: r.created_at,
    })),
  }
}

export async function recordPreferenceSignal(params: {
  customerId: string
  isAuthenticated: boolean
  productId: string
  signalType: 'viewed' | 'added_to_cart' | 'purchased' | 'dismissed'
}): Promise<void> {
  const supabase = getSupabaseClient()

  // Look up product name for denormalized storage.
  const { data: product } = await supabase
    .from('products')
    .select('name')
    .eq('id', params.productId)
    .maybeSingle()

  await supabase.from('customer_preference_signals').insert({
    customer_id: params.customerId,
    user_id: params.isAuthenticated ? params.customerId : null,
    signal_type: params.signalType,
    product_id: params.productId,
    product_name: (product as { name?: string } | null)?.name ?? null,
  })
}
