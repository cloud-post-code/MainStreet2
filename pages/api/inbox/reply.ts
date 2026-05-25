export const runtime = 'edge'

import { getSupabaseClient } from '../../../lib/supabase'
import type { InboxThread, MessageParam } from '../../../lib/types'

async function getCustomerId(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const SYSTEM_PROMPT = `You are Mason, a warm and knowledgeable personal shopper for Main Street — a curated collection of local businesses in small-town America.

You reached out to this customer first with a recommendation or update. Now they're responding.

Rules:
- Stay warm, personal, and brief. You know this customer.
- If they want to add something to their cart, help them do it.
- If they ask about a product you recommended, share what you know about it.
- Never mention AI, ChatGPT, OpenAI, or technical details.
- Keep responses under 3 sentences unless they ask a detailed question.`

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

  const customerId = await getCustomerId(req)
  const supabase = getSupabaseClient()

  const { data: thread, error: fetchError } = await supabase
    .from('inbox_threads')
    .select('*')
    .eq('id', threadId)
    .eq('customer_id', customerId)
    .single()

  if (fetchError || !thread) {
    return new Response(JSON.stringify({ error: 'Thread not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const currentThread = thread as InboxThread
  const updatedMessages: MessageParam[] = [
    ...currentThread.messages,
    { role: 'user', content: message },
  ]

  // Build context for OpenAI — thread history + opening product if any
  const openaiMessages = updatedMessages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
  }))

  if (currentThread.opening_product) {
    openaiMessages.unshift({
      role: 'user',
      content: `[Context: You previously reached out about this product: ${JSON.stringify(currentThread.opening_product)}. Subject: "${currentThread.subject}"]`,
    })
  }

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  const write = (chunk: string) => writer.write(encoder.encode(chunk))

  ;(async () => {
    try {
      const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 512,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...openaiMessages,
          ],
        }),
        signal: req.signal,
      })

      if (!openaiResp.ok) {
        await write(sseEvent('error', { message: 'Something went wrong' }))
        return
      }

      const reader = openaiResp.body!.getReader()
      const dec = new TextDecoder()
      let fullText = ''
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const chunk = JSON.parse(payload) as { choices: Array<{ delta: { content?: string } }> }
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              fullText += text
              await write(sseEvent('delta', { text }))
            }
          } catch { /* malformed chunk */ }
        }
      }

      const finalMessages: MessageParam[] = [
        ...updatedMessages,
        { role: 'assistant', content: fullText },
      ]

      await supabase
        .from('inbox_threads')
        .update({
          messages: finalMessages,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', threadId)

      await write(sseEvent('done', {}))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await write(sseEvent('error', { message: 'Something went wrong' }))
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
