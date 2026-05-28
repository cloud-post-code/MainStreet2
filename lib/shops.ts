import { getSupabaseClient } from './supabase'
import type { Business } from './types'

const SHOP_COLUMNS =
  'id, name, url, town, category_id, address_street, address_city, address_state, address_zip, contact_name, contact_email, contact_phone, status'

export interface ShopSearchFilters {
  query?: string
  town?: string
  category_id?: string
  limit?: number
}

export async function searchShops(filters: ShopSearchFilters = {}): Promise<Business[]> {
  const supabase = getSupabaseClient()
  let q = supabase.from('businesses').select(SHOP_COLUMNS).eq('status', 'active')

  if (filters.query?.trim()) {
    const term = filters.query.trim().replace(/[%_]/g, '\\$&')
    q = q.ilike('name', `%${term}%`)
  }
  if (filters.town?.trim()) q = q.ilike('town', filters.town.trim())
  if (filters.category_id) q = q.eq('category_id', filters.category_id)

  q = q.order('name', { ascending: true }).limit(filters.limit ?? 10)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Business[]
}

export async function getShopById(id: string): Promise<Business | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('businesses')
    .select(SHOP_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as Business | null
}
