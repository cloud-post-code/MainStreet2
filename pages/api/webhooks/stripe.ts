import Stripe from 'stripe'
import { stripe } from '../../../lib/stripe'
import { getSupabaseClient } from '../../../lib/supabase'

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const sig = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !webhookSecret) {
    return new Response('Missing signature or webhook secret', { status: 400 })
  }

  let event: Stripe.Event
  try {
    const body = await req.text()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 })
  }

  const supabase = getSupabaseClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.order_id
    const userId = session.metadata?.user_id
    if (orderId) {
      const update: Record<string, unknown> = {
        status: 'paid',
        stripe_payment_intent: session.payment_intent as string,
        customer_email: (session.customer_details?.email) ?? undefined,
      }
      if (userId) update.user_id = userId
      await supabase.from('orders').update(update).eq('id', orderId)
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.order_id
    if (orderId) {
      await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId)
        .eq('status', 'pending')
    }
  }

  return new Response('ok', { status: 200 })
}
