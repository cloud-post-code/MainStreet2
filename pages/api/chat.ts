export const runtime = 'edge'

import { getSupabaseClient } from '../../lib/supabase'
import { deriveSearchQuery, searchProducts } from '../../lib/search'
import { resolveCustomerId } from '../../lib/auth'
import type { ConversationRow, ChatErrorCode, ChatErrorEvent, MessageParam, ProductResult } from '../../lib/types'

const TURN_LIMIT = 8
const TTL_MS = 24 * 60 * 60 * 1000

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function errorEvent(code: number, type: ChatErrorCode, message: string, retry: boolean): string {
  const payload: ChatErrorEvent = { code, type, message, retry }
  return sseEvent('error', payload)
}

function shouldSearch(_messages: MessageParam[], _turnCount: number): boolean {
  // Always search — every user message refines the query and gives more context.
  // Skipping search after Mason asks a question was causing Mason to go 2+ turns
  // without any DB lookup, leading to repeated clarifying questions.
  return true
}

// Convert our MessageParam history to OpenAI chat format
function toOpenAIMessages(messages: MessageParam[], productResults: ProductResult[], searchRan: boolean): Array<{ role: string; content: string }> {
  const openaiMessages: Array<{ role: string; content: string }> = []

  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : ''
    openaiMessages.push({ role: m.role, content })
  }

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
  } else if (searchRan) {
    // Search ran but found nothing — explicit zero-results signal so Mason cannot hallucinate
    openaiMessages.push({
      role: 'user',
      content: '[Product search returned 0 results from the database. DO NOT name, describe, or recommend any products or shops. Ask the customer one clarifying question to help narrow the search.]',
    })
  }

  return openaiMessages
}

const SYSTEM_PROMPT = `You are Mason, a warm and knowledgeable personal shopper for Main Street — a curated collection of local businesses in small-town America.

Your job: guide customers to find exactly what they need from local shops they can trust.

DATABASE-ONLY RULE: You may only mention products and shops that appear in the [Product search results] injected into this conversation. Never invent, guess, or describe products not in those results.

How to help:
1. ALWAYS show product cards when [Product search results] are available — even on the very first turn if results exist. Never skip showing products when the database returned them.
2. When showing products, pick the 3–4 best matches. For each, name the shop, the item, and one sentence on why it fits their need.
3. After showing products, you MAY ask one optional follow-up question if you're genuinely unsure about something important (e.g. "Do you want to stay under $50?" or "Is this for indoor or outdoor use?"). Keep it short — one question max, and only if truly helpful.
4. If the request is very vague with no context at all (no recipient, no occasion, no category), ask ONE focused clarifying question first — but then show products on the very next turn regardless.
5. When search returns 0 results, say you're still looking and ask one targeted question to narrow the search. Never name shops or products that aren't in the results.
6. Keep responses warm, brief, and personal. You are their local shopper, not a search engine.
7. Never mention AI, technology, search engines, or databases.
8. For refinements, echo what you understood: "Here are 3 options under $30 in blue:"`

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
  const identity = await resolveCustomerId(req)
  const fingerprint = identity.id
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

    // Verify ownership: authenticated users check user_id, guests check fingerprint
    if (identity.isAuthenticated) {
      if (data.user_id && data.user_id !== identity.id) {
        return new Response(errorEvent(404, 'session_not_found', 'Session not found or expired', false), {
          status: 404,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
    } else if (!isOff && data.session_fingerprint) {
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
    const newRow: Record<string, unknown> = {
      messages: [],
      turn_count: 0,
      version: 0,
      expires_at: expiresAt,
      session_fingerprint: identity.isAuthenticated ? null : fingerprint,
      user_id: identity.isAuthenticated ? identity.id : null,
    }
    const { data, error } = await supabase.from('conversations').insert(newRow).select().single()
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
      productResults = await searchProducts(derivedQuery, 4)
    }
  }

  const searchRan = derivedQuery !== null
  const openaiMessages = toOpenAIMessages(updatedMessages, productResults, searchRan)

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
        // Always emit product cards when results exist — Mason can show products and ask a follow-up simultaneously
        if (productResults.length > 0) {
          await write(sseEvent('products', { products: productResults }))
        }
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
