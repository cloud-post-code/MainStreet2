export const runtime = 'edge'

import { getSupabaseClient } from '../../lib/supabase'
import { deriveSearchQuery, searchProducts } from '../../lib/search'
import type { ConversationRow, ChatErrorCode, ChatErrorEvent, MessageParam, ProductResult } from '../../lib/types'

const TURN_LIMIT = 8
const TTL_MS = 24 * 60 * 60 * 1000

// Web Crypto fingerprint — never node:crypto (not available in Edge runtime)
async function buildFingerprint(req: Request): Promise<string> {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? ''
  const raw = new TextEncoder().encode(`${ua}|${ip}`)
  const hash = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function errorEvent(code: number, type: ChatErrorCode, message: string, retry: boolean): string {
  const payload: ChatErrorEvent = { code, type, message, retry }
  return sseEvent('error', payload)
}

function shouldSearch(messages: MessageParam[], turnCount: number): boolean {
  if (turnCount === 0) return true
  if (turnCount >= 2) return true
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant) return true
  const content = typeof lastAssistant.content === 'string'
    ? lastAssistant.content
    : lastAssistant.content.map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join('')
  return !content.trim().endsWith('?')
}

// Convert our MessageParam history to OpenAI chat format
function toOpenAIMessages(messages: MessageParam[], productResults: ProductResult[]): Array<{ role: string; content: string }> {
  const openaiMessages: Array<{ role: string; content: string }> = []

  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ''
    openaiMessages.push({ role: m.role, content })
  }

  // Inject product results as a system-style context message after user's last message
  if (productResults.length > 0) {
    const productJson = JSON.stringify(productResults.map(p => ({
      name: p.name,
      price: p.price,
      shop: p.business_name,
      url: p.url,
      image_url: p.image_url,
      last_seen: p.last_seen,
    })))
    openaiMessages.push({
      role: 'user',
      content: `[Product search results — use these to answer the customer]: ${productJson}`,
    })
  }

  return openaiMessages
}

const SYSTEM_PROMPT = `You are Mason, a warm and knowledgeable personal shopper for Main Street — a curated collection of local businesses in small-town America.

Your job: help customers find exactly what they need from local shops they can trust.

Rules:
- Ask at most 1 clarifying question when the request is ambiguous. Never ask 2 questions in a row.
- When you have product results, present them warmly and specifically. Name the shop. Name the item.
- For refinements, explicitly echo what you understood: "Here's what I found in blue under $30:"
- Keep responses warm, brief, and personal. You're their local shopper, not a search engine.
- Never mention AI, ChatGPT, OpenAI, or technical details.
- If product data is provided, present those specific items.`

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(errorEvent(405, 'internal_error', 'Method not allowed', false), {
      status: 405,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const { sessionId, message } = await req.json() as { sessionId?: string; message?: string }
  if (!message?.trim()) {
    return new Response(errorEvent(400, 'internal_error', 'message is required', false), {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  const supabase = getSupabaseClient()
  const fingerprint = await buildFingerprint(req)
  const isRelaxed = process.env.FINGERPRINT_ENFORCEMENT === 'relaxed'
  const isOff = process.env.FINGERPRINT_ENFORCEMENT === 'off'

  let conversation: ConversationRow | null = null
  let isNewSession = false

  if (sessionId) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!data) {
      return new Response(errorEvent(404, 'session_not_found', 'Session not found or expired', false), {
        status: 404,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    if (new Date(data.expires_at) < new Date()) {
      return new Response(errorEvent(404, 'session_expired', 'Session has expired', false), {
        status: 404,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    if (!isOff && data.session_fingerprint) {
      const fingerprintMatches = isRelaxed
        ? fingerprint.startsWith(data.session_fingerprint.slice(0, 16))
        : fingerprint === data.session_fingerprint
      if (!fingerprintMatches) {
        return new Response(errorEvent(404, 'session_not_found', 'Session not found or expired', false), {
          status: 404,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
    }

    if (data.turn_count >= TURN_LIMIT) {
      return new Response(errorEvent(422, 'turn_limit_exceeded', 'Start a new conversation to keep shopping', false), {
        status: 422,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    conversation = data as ConversationRow
  } else {
    isNewSession = true
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    const { data, error } = await supabase
      .from('conversations')
      .insert({ messages: [], turn_count: 0, version: 0, session_fingerprint: fingerprint, expires_at: expiresAt })
      .select()
      .single()
    if (error || !data) {
      return new Response(errorEvent(500, 'internal_error', 'Could not start session', false), {
        status: 500,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
    conversation = data as ConversationRow
  }

  const updatedMessages: MessageParam[] = [
    ...conversation.messages,
    { role: 'user', content: message },
  ]

  let productResults: ProductResult[] = []
  let derivedQuery: string | null = null
  if (shouldSearch(updatedMessages, conversation.turn_count)) {
    derivedQuery = await deriveSearchQuery(updatedMessages)
    if (derivedQuery) {
      productResults = await searchProducts(derivedQuery, 5)
    }
  }

  const openaiMessages = toOpenAIMessages(updatedMessages, productResults)

  const isDebug = process.env.VERCEL_ENV !== 'production' &&
    new URL(req.url).searchParams.get('debug') === '1'

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  const write = (chunk: string) => writer.write(encoder.encode(chunk))

  ;(async () => {
    try {
      if (isNewSession) {
        await write(sseEvent('session', { sessionId: conversation!.id }))
      }

      if (isDebug && productResults.length > 0) {
        await write(sseEvent('debug', { derivedQuery, productCount: productResults.length }))
      }

      const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 1024,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...openaiMessages,
          ],
        }),
        signal: req.signal,
      })

      if (!openaiResp.ok) {
        const err = await openaiResp.text()
        console.error('OpenAI error:', err)
        await write(errorEvent(500, 'internal_error', 'Something went wrong', false))
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
          } catch {
            // malformed chunk — skip
          }
        }
      }

      const assistantMessage: MessageParam = { role: 'assistant', content: fullText }
      const finalMessages: MessageParam[] = [...updatedMessages, assistantMessage]

      const newExpiry = new Date(Date.now() + TTL_MS).toISOString()
      const { error: updateError } = await supabase
        .from('conversations')
        .update({
          messages: finalMessages,
          last_search_results: productResults.length > 0 ? productResults : conversation!.last_search_results,
          last_derived_query: derivedQuery ?? conversation!.last_derived_query,
          turn_count: conversation!.turn_count + 1,
          version: conversation!.version + 1,
          expires_at: newExpiry,
        })
        .eq('id', conversation!.id)
        .eq('version', conversation!.version)

      if (updateError) {
        await write(sseEvent('error', { code: 409, type: 'version_conflict', message: 'Conversation updated elsewhere', retry: true }))
      } else {
        await write(sseEvent('done', { turnCount: conversation!.turn_count + 1 }))
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await write(errorEvent(500, 'internal_error', 'Something went wrong', false))
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
