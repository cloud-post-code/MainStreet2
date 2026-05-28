import type { NextApiRequest, NextApiResponse } from 'next'
import { getSupabaseClient } from '../../lib/supabase'
import { resolveCustomerId } from '../../lib/auth'
import { runMasonAgent } from '../../lib/mason/agent'
import { serializeSSE, type StreamEvent } from '../../lib/mason/blocks'
import type { ConversationRow, ChatErrorCode, ChatErrorEvent, MessageParam } from '../../lib/types'

export const config = {
  api: { responseLimit: false },
}

const TURN_LIMIT = 8
const TTL_MS = 24 * 60 * 60 * 1000

function errorEvent(code: number, type: ChatErrorCode, message: string, retry: boolean): StreamEvent {
  const payload: ChatErrorEvent = { code, type, message, retry }
  return { event: 'error', data: payload }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'text/event-stream')
    res.status(405).end(serializeSSE(errorEvent(405, 'internal_error', 'Method not allowed', false)))
    return
  }

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

    if (isNewSession) {
      write({ event: 'session', data: { sessionId: conversation.id } })
    }

    const seedMessages: MessageParam[] = [
      ...conversation.messages,
      { role: 'user', content: message },
    ]

    const agentResult = await runMasonAgent({
      messages: seedMessages,
      customerId: identity.id,
      isAuthenticated: identity.isAuthenticated,
      mode: 'chat',
      emit: write,
    })

    const newExpiry = new Date(Date.now() + TTL_MS).toISOString()
    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        messages: agentResult.finalMessages,
        turn_count: conversation.turn_count + 1,
        version: conversation.version + 1,
        expires_at: newExpiry,
      })
      .eq('id', conversation.id)
      .eq('version', conversation.version)

    if (updateError) {
      write({ event: 'error', data: { code: 409, type: 'version_conflict', message: 'Conversation updated elsewhere', retry: true } })
    } else {
      write({ event: 'done', data: { turnCount: conversation.turn_count + 1 } })
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Mason agent error:', err)
      write(errorEvent(500, 'internal_error', 'Something went wrong', false))
    }
  } finally {
    end()
  }
}
