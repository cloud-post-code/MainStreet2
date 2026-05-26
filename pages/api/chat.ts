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

Your job: guide customers to find exactly what they need from local shops they can trust.

DATABASE-ONLY RULE: You may only mention products and shops that appear in the [Product search results] injected into this conversation. Never invent, guess, or describe products not in those results. If no results are provided, ask a clarifying question instead.

How to help:
1. If the request is vague (no recipient, no budget, no occasion), ask ONE focused question — e.g. "Who is this for?" or "What's your budget?" Never ask more than one question at a time.
2. Never ask a question two turns in a row. If you asked last time, this time you recommend.
3. When product results are available, pick the 3–4 best matches. For each, name the shop, the item, and one sentence on why it fits their need.
4. Keep responses warm, brief, and personal. You are their local shopper, not a search engine.
5. Never mention AI, technology, search engines, or databases.
6. For refinements, echo what you understood: "Here are 3 options under $30 in blue:"`

function generateSuggestions(
  fullText: string,
  products: ProductResult[],
  messages: MessageParam[]
): string[] {
  // Treat any response with a '?' and no products as a clarifying-question turn.
  // Mason often adds a follow-up sentence after the '?' (ending in '!'), so
  // trimEnd().endsWith('?') is too narrow.
  const isQuestion = fullText.includes('?') && products.length === 0
  const masonLower = fullText.toLowerCase()

  // Extract user's original ask for personalisation context
  const firstUserMsg = messages.find(m => m.role === 'user')
  const userCtx = (typeof firstUserMsg?.content === 'string' ? firstUserMsg.content : '').toLowerCase()
  const isSheCtx = /\bshe\b|\bher\b|\bsister\b|\bgirlfriend\b|\bwife\b|\bmom\b|\bmother\b|\bdaughter\b|\bgrandma\b/.test(userCtx)
  const isHeCtx  = /\bhe\b|\bhim\b|\bbrother\b|\bboyfriend\b|\bhusband\b|\bdad\b|\bfather\b|\bson\b|\bgrandpa\b/.test(userCtx)
  const isGift   = /\bgift\b|\bpresent\b|\bsister\b|\bbrother\b|\bmother\b|\bfather\b|\bfriend\b|\bpartner\b|\bwife\b|\bhusband\b|\bson\b|\bdaughter\b|\bgrandma\b|\bgrandpa\b/.test(userCtx)

  // When Mason shows products: offer price refinement + escape hatches
  if (products.length > 0 && !isQuestion) {
    const prices = products.map(p => p.price).sort((a, b) => a - b)
    const min = prices[0]
    let cap: number
    if (min > 100) cap = Math.round(min * 0.65 / 25) * 25
    else if (min > 50) cap = Math.round(min * 0.7 / 10) * 10
    else cap = Math.round(min * 0.75 / 5) * 5

    if (cap >= 10) return [`Under $${cap}`, 'Something more unique', 'These are perfect!']
    return ['Show me more options', 'Something different?', 'These are perfect!']
  }

  // When Mason asks a clarifying question: suggest 3 natural answers
  if (isQuestion) {
    if (/\bwho\b.{0,30}\bfor\b|\bfor whom\b|\brecipient\b|\bwho.{0,20}buying\b/.test(masonLower)) {
      return ["It's for me", "It's a gift", "For my whole family"]
    }
    if (/\bbudget\b|\bspend\b|\bhow much\b|\bprice range\b|\bafford\b|\bwilling to pay\b/.test(masonLower)) {
      if (isGift) {
        const pronoun = isSheCtx ? 'she' : isHeCtx ? 'he' : 'they'
        return ["Under $30", "Under $50", `No limit — ${pronoun}'s worth it!`]
      }
      return ["Under $30", "Under $50", "No budget limit!"]
    }
    if (/\boccasion\b|\bevent\b|\bbirthday\b|\bholiday\b|\bcelebrat\b|\bspecial\b/.test(masonLower)) {
      return ["Everyday use", "Special occasion", "It's a birthday!"]
    }
    if (/\bstyle\b|\baesthetic\b|\blook and feel\b|\bdesign prefer\b/.test(masonLower)) {
      return ["Natural & rustic", "Modern & clean", "Either works!"]
    }
    if (/\bcolor\b|\bcolour prefer\b/.test(masonLower)) {
      return ["No preference", "Earth tones", "Something colorful!"]
    }
    if (/\bage\b|\bhow old\b|\bchild\b|\bkid\b|\bteen\b|\byoung\b/.test(masonLower)) {
      return ["Young child (2–8)", "Teenager", "Adult"]
    }
    if (/\binterest\b|\bhobby\b|\bhobbies\b|\bpassion\b|\binto\b/.test(masonLower)) {
      return ["Something practical", "Something fun!", "Surprise me!"]
    }
    if (/\btype\b|\bcategor\b|\bkind of\b|\bwhich type\b/.test(masonLower)) {
      return ["Something practical", "Something fun!", "Surprise me!"]
    }
    return ["Tell me more", "Any suggestions?", "Surprise me!"]
  }

  return []
}

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
        const isAskingQuestion = fullText.includes('?') && productResults.length === 0
        if (productResults.length > 0 && !isAskingQuestion) {
          await write(sseEvent('products', { products: productResults }))
        }
        const suggestions = generateSuggestions(fullText, productResults, updatedMessages)
        await write(sseEvent('done', { turnCount: conversation!.turn_count + 1, suggestions }))
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
