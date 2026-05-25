import Stripe from 'stripe'
import { getSupabaseClient } from './supabase'
import type { ProductResult } from './types'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
})

export interface CheckoutItem {
  product: ProductResult
  quantity: number
}

export async function createCheckoutSession(
  items: CheckoutItem[],
  conversationId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const supabase = getSupabaseClient()

  // Snapshot fulfillment context to orders table before conversation can expire
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      conversation_id: conversationId,
      status: 'pending',
      context: {
        items: items.map(i => ({
          name: i.product.name,
          price: i.product.price,
          shop: i.product.business_name,
          url: i.product.url,
          image_url: i.product.image_url,
          quantity: i.quantity,
        })),
      },
      total_cents: items.reduce((sum, i) => sum + Math.round(i.product.price * 100) * i.quantity, 0),
    })
    .select('id')
    .single()

  if (orderError || !order) {
    throw new Error('Failed to create order record')
  }

  const lineItems = items.map(item => ({
    price_data: {
      currency: 'usd',
      unit_amount: Math.round(item.product.price * 100),
      product_data: {
        name: item.product.name,
        description: `From ${item.product.business_name}`,
        images: item.product.image_url ? [item.product.image_url] : [],
      },
    },
    quantity: item.quantity,
  }))

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      order_id: order.id,
      conversation_id: conversationId,
    },
  })

  // Link Stripe session to our order
  await supabase
    .from('orders')
    .update({ stripe_session_id: session.id })
    .eq('id', order.id)

  return session.url!
}

export { stripe }
