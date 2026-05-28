import type { NextApiRequest, NextApiResponse } from 'next'
import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'
import { runMasonAgent } from '../../../lib/mason/agent'
import { serializeSSE, type StreamEvent } from '../../../lib/mason/blocks'
import type { InboxThread, MessageParam } from '../../../lib/types'

export const config = {
  api: { responseLimit: false },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { threadId, message } = req.body as { threadId?: string; message?: string }
  if (!threadId || !message?.trim()) {
    res.status(400).json({ error: 'threadId and message are required' })
    return
  }

  // Build a web Request for resolveCustomerId (it expects a Fetch-style Request).
  const proxyHeaders: Record<string, string> = {}
  const rawCookie = req.headers['cookie']
  if (rawCookie) proxyHeaders['cookie'] = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie
  const rawUA = req.headers['user-agent']
  if (rawUA) proxyHeaders['user-agent'] = Array.isArray(rawUA) ? rawUA[0] : rawUA
  const rawXFF = req.headers['x-forwarded-for']
  if (rawXFF) proxyHeaders['x-forwarded-for'] = Array.isArray(rawXFF) ? rawXFF[0] : rawXFF
  const webReq = new Request('http://localhost/api/inbox/reply', { headers: proxyHeaders })

  const identity = await resolveCustomerId(webReq)
  const supabase = getSupabaseClient()

  const baseQuery = supabase.from('inbox_threads').select('*').eq('id', threadId)
  const { data: thread, error: fetchError } = await (identity.isAuthenticated
    ? baseQuery.eq('user_id', identity.id)
    : baseQuery.eq('customer_id', identity.id)
  ).single()

  if (fetchError || !thread) {
    res.status(404).json({ error: 'Thread not found' })
    return
  }

  const currentThread = thread as InboxThread

  const seedMessages: MessageParam[] = []
  if (currentThread.opening_product) {
    seedMessages.push({
      role: 'user',
      content: `[Earlier I reached out to this customer about: ${JSON.stringify(currentThread.opening_product)}. Subject: "${currentThread.subject}".]`,
    })
  }
  seedMessages.push(...currentThread.messages)
  seedMessages.push({ role: 'user', content: message })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const write = (evt: StreamEvent) => {
    res.write(serializeSSE(evt))
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }

  try {
    const result = await runMasonAgent({
      messages: seedMessages,
      customerId: identity.id,
      isAuthenticated: identity.isAuthenticated,
      mode: 'inbox',
      emit: write,
    })

    // Strip the synthetic opening-product context message before persisting.
    const persistedMessages = currentThread.opening_product
      ? result.finalMessages.slice(1)
      : result.finalMessages

    await supabase
      .from('inbox_threads')
      .update({
        messages: persistedMessages,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', threadId)

    write({ event: 'done', data: {} })
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Inbox Mason agent error:', err)
      write({ event: 'error', data: { code: 500, type: 'internal_error', message: 'Something went wrong', retry: false } })
    }
  } finally {
    res.end()
  }
}
