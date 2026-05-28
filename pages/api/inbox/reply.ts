export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import { resolveCustomerId } from '../../../lib/auth'
import { runMasonAgent } from '../../../lib/mason/agent'
import { serializeSSE, type StreamEvent } from '../../../lib/mason/blocks'
import type { InboxThread, MessageParam } from '../../../lib/types'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { threadId, message } = await req.json() as { threadId?: string; message?: string }
  if (!threadId || !message?.trim()) {
    return new Response(JSON.stringify({ error: 'threadId and message are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const identity = await resolveCustomerId(req)
  const supabase = getSupabaseClient()

  const baseQuery = supabase.from('inbox_threads').select('*').eq('id', threadId)
  const { data: thread, error: fetchError } = await (identity.isAuthenticated
    ? baseQuery.eq('user_id', identity.id)
    : baseQuery.eq('customer_id', identity.id)
  ).single()

  if (fetchError || !thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const currentThread = thread as InboxThread

  // Seed messages: prepend an opening-product context message when applicable
  // so Mason recalls what the thread is about without needing to call a tool.
  const seedMessages: MessageParam[] = []
  if (currentThread.opening_product) {
    seedMessages.push({
      role: 'user',
      content: `[Earlier I reached out to this customer about: ${JSON.stringify(currentThread.opening_product)}. Subject: "${currentThread.subject}".]`,
    })
  }
  seedMessages.push(...currentThread.messages)
  seedMessages.push({ role: 'user', content: message })

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  const write = (evt: StreamEvent) => {
    void writer.write(encoder.encode(serializeSSE(evt)))
  }

  ;(async () => {
    try {
      const result = await runMasonAgent({
        messages: seedMessages,
        customerId: identity.id,
        isAuthenticated: identity.isAuthenticated,
        mode: 'inbox',
        emit: write,
        signal: req.signal,
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
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
