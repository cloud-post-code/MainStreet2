import { createClient } from '@supabase/supabase-js'

// Edge-compatible Supabase client using REST (no node:fetch, no node:crypto)
export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env vars')
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
