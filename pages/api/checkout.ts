export const runtime = 'edge'

import { getSupabaseClient } from '../../lib/supabase'
import { resolveCustomerId } from '../../lib/auth'
import { createCheckoutSession } from '../../lib/stripe'
import type { ProductResult } from '../../lib/types'

interface CheckoutBody {
  items: Array<{ product: ProductResult; quantity: number }>
  conversationId: string
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json() as CheckoutBody
  if (!body.items?.length || !body.conversationId) {
    return new Response(JSON.stringify({ error: 'items and conversationId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const identity = await resolveCustomerId(req)
    const origin = req.headers.get('origin') ?? 'http://localhost:3000'

    // Backfill user_id on the conversation so the Stripe webhook can tie the order to this account
    if (identity.isAuthenticated) {
      const supabase = getSupabaseClient()
      await supabase
        .from('conversations')
        .update({ user_id: identity.id })
        .eq('id', body.conversationId)
    }

    const url = await createCheckoutSession(
      body.items,
      body.conversationId,
      `${origin}/?checkout=success`,
      `${origin}/?checkout=cancelled`,
      identity.isAuthenticated ? identity.id : undefined,
    )
    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('checkout error', err)
    return new Response(JSON.stringify({ error: 'Could not create checkout session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
