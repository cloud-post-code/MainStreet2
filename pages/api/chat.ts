import type { NextApiRequest, NextApiResponse } from 'next'
import { getSupabaseClient } from '../../lib/supabase'
import { deriveSearchQuery, searchProducts } from '../../lib/search'
import { resolveCustomerId } from '../../lib/auth'
import type { ConversationRow, ChatErrorCode, ChatErrorEvent, MessageParam, ProductResult } from '../../lib/types'

export const config = {
  api: { responseLimit: false },
}

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
  return true
}

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
1. If the very first request is vague, ask ONE focused question — e.g. "Who is this for?" or "What's your budget?" Never ask more than one question at a time.
2. FIRST RESULTS RULE (hard): The moment you receive any [Product search results], you MUST present them. Do not ask another question instead of showing results — you may add a brief follow-up question AFTER the recommendation, but never withhold products to ask more questions.
3. Present 3–4 best matches. For each, name the shop, the item, and one sentence on why it fits their need.
4. A single short follow-up is welcome alongside a recommendation — e.g. "Here are a few options! Any preference on price range?" — but products always come first.
5. When search returns 0 results: ask ONE specific narrowing question. Do not ask more than two clarifying questions total across the whole conversation.
6. Keep responses warm, brief, and personal. You are their local shopper, not a search engine.
7. Never mention AI, technology, search engines, or databases.
8. For refinements, echo what you understood: "Here are 3 options under $30 in blue:"`

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/event-stream')
    res.status(405).end(errorEvent(405, 'internal_error', 'Method not allowed', false))
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const write = (chunk: string) => {
    res.write(chunk)
    // Flush if available (some Node.js http adapters support this)
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }
  const end = () => res.end()

  try {
    const { sessionId, message } = req.body as { sessionId?: string; message?: string }
    if (!message?.trim()) {
      write(errorEvent(400, 'internal_error', 'message is required', false))
      end()
      return
    }

    const proxyHeaders: Record<string, string> = {}
    const rawCookie = req.headers['cookie']
    if (rawCookie) proxyHeaders['cookie'] = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie
    const rawUA = req.headers['user-agent']
    if (rawUA) proxyHeaders['user-agent'] = Array.isArray(rawUA) ? rawUA[0] : rawUA
    const rawXFF = req.headers['x-forwarded-for']
    if (rawXFF) proxyHeaders['x-forwarded-for'] = Array.isArray(rawXFF) ? rawXFF[0] : rawXFF
    const webReq = new Request('http://localhost/api/chat', { headers: proxyHeaders })

    const supabase = getSupabaseClient()
    const identity = await resolveCustomerId(webReq)
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
        write(errorEvent(404, 'session_not_found', 'Session not found or expired', false))
        end()
        return
      }

      if (new Date(data.expires_at) < new Date()) {
        write(errorEvent(404, 'session_expired', 'Session has expired', false))
        end()
        return
      }

      if (identity.isAuthenticated) {
        if (data.user_id && data.user_id !== identity.id) {
          write(errorEvent(404, 'session_not_found', 'Session not found or expired', false))
          end()
          return
        }
      } else if (!isOff && data.session_fingerprint) {
        const fingerprintMatches = isRelaxed
          ? fingerprint.startsWith(data.session_fingerprint.slice(0, 16))
          : fingerprint === data.session_fingerprint
        if (!fingerprintMatches) {
          write(errorEvent(404, 'session_not_found', 'Session not found or expired', false))
          end()
          return
        }
      }

      if (data.turn_count >= TURN_LIMIT) {
        write(errorEvent(422, 'turn_limit_exceeded', 'Start a new conversation to keep shopping', false))
        end()
        return
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
        write(errorEvent(500, 'internal_error', 'Could not start session', false))
        end()
        return
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
      (req.query.debug === '1')

    if (isNewSession) {
      write(sseEvent('session', { sessionId: conversation.id }))
    }

    if (isDebug && productResults.length > 0) {
      write(sseEvent('debug', { derivedQuery, productCount: productResults.length }))
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
    })

    if (!openaiResp.ok) {
      const err = await openaiResp.text()
      console.error('OpenAI error:', err)
      write(errorEvent(500, 'internal_error', 'Something went wrong', false))
      end()
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
            write(sseEvent('delta', { text }))
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
        last_search_results: productResults.length > 0 ? productResults : conversation.last_search_results,
        last_derived_query: derivedQuery ?? conversation.last_derived_query,
        turn_count: conversation.turn_count + 1,
        version: conversation.version + 1,
        expires_at: newExpiry,
      })
      .eq('id', conversation.id)
      .eq('version', conversation.version)

    if (updateError) {
      write(sseEvent('error', { code: 409, type: 'version_conflict', message: 'Conversation updated elsewhere', retry: true }))
    } else {
      const isAskingQuestion = fullText.trimEnd().endsWith('?')
      if (productResults.length > 0 && !isAskingQuestion) {
        write(sseEvent('products', { products: productResults }))
      }
      write(sseEvent('done', { turnCount: conversation.turn_count + 1 }))
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      write(errorEvent(500, 'internal_error', 'Something went wrong', false))
    }
  } finally {
    end()
  }
}
