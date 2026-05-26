export const runtime = 'edge'

import { getSupabaseClient } from '../../lib/supabase'
import { searchProductsMulti, searchBusinesses } from '../../lib/search'
import { MASON_TOOLS } from '../../lib/tools'
import { resolveCustomerId } from '../../lib/auth'
import type { ConversationRow, ChatErrorCode, ChatErrorEvent, MessageParam, ProductResult, BusinessResult } from '../../lib/types'

const TURN_LIMIT = 8
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_TOOL_ROUNDS = 4

// Wire-format messages for OpenAI — never stored to DB (only user/assistant MessageParam[] is persisted)
type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function errorEvent(code: number, type: ChatErrorCode, message: string, retry: boolean): string {
  const payload: ChatErrorEvent = { code, type, message, retry }
  return sseEvent('error', payload)
}

const SYSTEM_PROMPT = `You are Mason, a warm and knowledgeable personal shopper for Main Street — a curated collection of local businesses in small-town America.

You have three tools:
- search_products: search the catalog with 2–4 varied semantic queries to maximize recall
- search_businesses: find local shops by name, type, or specialty
- build_cards: render product/business cards in the UI — call this with the specific IDs you want to highlight

Search protocol:
- On the first customer message, always search before responding — never respond without searching first.
- Use 3–4 varied queries in search_products (the literal request, broader category, related descriptors, occasion). Cast a wide net.
- Results come back ranked by semantic similarity. Even similarity scores around 0.35–0.55 are still relevant — pick the best 3–4 and show them.
- After getting ANY results, call build_cards with the IDs of items you are recommending, then write your response. Show the cards even if they are imperfect — the customer can refine from there.
- For follow-up refinements, search again with refined queries.
- Never invent products — only recommend items returned by your search tools.
- Only ask a clarifying question if search_products genuinely returned ZERO results across all your queries. Never ask more than 1 clarifying question total.

Conversation rules:
- Keep responses warm, brief, and personal. You are their local shopper, not a search engine.
- Never mention AI, technology, search engines, or databases.
- For refinements, echo what you understood: "Here are 3 options in blue under $30:"`

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

      // In-memory indexes for this turn (for build_cards ID lookup)
      const productIndex = new Map<string, ProductResult>()
      const businessIndex = new Map<string, BusinessResult>()
      let allProductResults: ProductResult[] = []

      // Build the OpenAI messages array (system + conversation history)
      const oaiMessages: OAIMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...updatedMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : '',
        })),
      ]

      let fullText = ''

      // Agentic tool loop — non-streaming rounds until Mason gives a final text response
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const toolResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 1024,
            stream: false,
            tools: MASON_TOOLS,
            tool_choice: 'auto',
            messages: oaiMessages,
          }),
        })

        if (!toolResp.ok) {
          const err = await toolResp.text()
          console.error('OpenAI error (tool round):', err)
          await write(errorEvent(500, 'internal_error', 'Something went wrong', false))
          return
        }

        const json = await toolResp.json() as {
          choices: Array<{
            finish_reason: string
            message: { role: string; content: string | null; tool_calls?: OAIToolCall[] }
          }>
        }
        const choice = json.choices[0]

        if (choice.finish_reason === 'tool_calls') {
          // Reconstruct explicitly rather than casting — the wire shape may omit content entirely
          const assistantTurn: OAIMessage = {
            role: 'assistant',
            content: choice.message.content ?? null,
            tool_calls: choice.message.tool_calls,
          }
          oaiMessages.push(assistantTurn)

          for (const tc of choice.message.tool_calls ?? []) {
            let args: Record<string, unknown>
            try {
              args = JSON.parse(tc.function.arguments)
            } catch {
              args = {}
            }

            let toolResult: string

            if (tc.function.name === 'search_products') {
              const queries = (args.queries as string[]) ?? []
              if (queries.length === 0) {
                oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'queries array is required and must be non-empty' }) })
                continue
              }
              const limitPerQuery = (args.limit_per_query as number) ?? 5
              const results = await searchProductsMulti(queries, limitPerQuery)
              results.forEach(p => {
                productIndex.set(p.id, p)
                allProductResults.push(p)
              })
              toolResult = JSON.stringify(
                results.map(p => ({
                  id: p.id,
                  name: p.name,
                  price: p.price,
                  shop: p.business_name,
                  url: p.url,
                  image_url: p.image_url,
                  similarity: p.similarity,
                }))
              )
              if (isDebug) {
                await write(sseEvent('debug', { tool: 'search_products', queries, count: results.length }))
              }

            } else if (tc.function.name === 'search_businesses') {
              const query = (args.query as string) ?? ''
              const town = args.town as string | undefined
              const limit = (args.limit as number) ?? 5
              const results = await searchBusinesses(query, town, limit)
              results.forEach(b => businessIndex.set(b.id, b))
              toolResult = JSON.stringify(results)
              if (isDebug) {
                await write(sseEvent('debug', { tool: 'search_businesses', query, count: results.length }))
              }

            } else if (tc.function.name === 'build_cards') {
              const pIds = (args.product_ids as string[]) ?? []
              const bIds = (args.business_ids as string[]) ?? []
              const products = pIds.map(id => productIndex.get(id)).filter(Boolean) as ProductResult[]
              const businesses = bIds.map(id => businessIndex.get(id)).filter(Boolean) as BusinessResult[]
              if (products.length > 0) await write(sseEvent('products', { products }))
              if (businesses.length > 0) await write(sseEvent('businesses', { businesses }))
              toolResult = JSON.stringify({ rendered_products: products.length, rendered_businesses: businesses.length })

            } else {
              toolResult = JSON.stringify({ error: 'unknown tool' })
            }

            oaiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult })
          }
          // Continue loop — Mason will now compose her text response
          continue
        }

        if (choice.finish_reason === 'stop') {
          fullText = choice.message.content ?? ''
          if (fullText) {
            await write(sseEvent('delta', { text: fullText }))
          }
          break
        }

        // Unexpected finish_reason — break to avoid infinite loop
        break
      }

      if (!fullText) {
        await write(errorEvent(500, 'internal_error', 'No response generated', true))
        return
      }

      // Persist conversation (only user+assistant turns — strip OAI tool messages)
      const assistantMessage: MessageParam = { role: 'assistant', content: fullText }
      const finalMessages: MessageParam[] = [...updatedMessages, assistantMessage]
      const newExpiry = new Date(Date.now() + TTL_MS).toISOString()

      const { error: updateError } = await supabase
        .from('conversations')
        .update({
          messages: finalMessages,
          last_search_results: allProductResults.length > 0 ? allProductResults : conversation!.last_search_results,
          last_derived_query: conversation!.last_derived_query,
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
