import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ContentBlock } from '../types'
import type { Emit } from './blocks'
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools'
import { getSystemPrompt } from './system-prompt'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096
const MAX_ITERATIONS = 10

export interface RunMasonAgentParams {
  messages: MessageParam[]
  customerId: string
  isAuthenticated: boolean
  mode: 'chat' | 'inbox'
  emit: Emit
  signal?: AbortSignal
}

export interface RunMasonAgentResult {
  finalMessages: MessageParam[]
  stopReason: string | null
  iterations: number
}

function uuid(): string {
  return (globalThis.crypto as Crypto).randomUUID()
}

/**
 * Streaming tool-use agent loop. Calls Anthropic with the conversation + tools,
 * streams text deltas as 'text_delta' SSE events, executes any tool_use blocks,
 * and re-enters the loop until stop_reason !== 'tool_use' (or MAX_ITERATIONS).
 */
export async function runMasonAgent(params: RunMasonAgentParams): Promise<RunMasonAgentResult> {
  const { customerId, isAuthenticated, mode, emit, signal } = params
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  const client = new Anthropic({ apiKey })
  const ctx: ToolContext = { customerId, isAuthenticated, emit }
  const system = getSystemPrompt(mode)

  const conversation: MessageParam[] = [...params.messages]
  let iterations = 0
  let stopReason: string | null = null

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_DEFINITIONS,
        messages: conversation as unknown as Anthropic.MessageParam[],
      },
      signal ? { signal } : undefined,
    )

    let currentTextId: string | null = null

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          currentTextId = uuid()
          emit({ event: 'text_start', data: { id: currentTextId } })
        } else if (event.content_block.type === 'tool_use') {
          emit({ event: 'tool_start', data: { id: event.content_block.id, name: event.content_block.name } })
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta' && currentTextId) {
          emit({ event: 'text_delta', data: { id: currentTextId, text: event.delta.text } })
        }
      } else if (event.type === 'content_block_stop') {
        if (currentTextId) {
          emit({ event: 'text_end', data: { id: currentTextId } })
          currentTextId = null
        }
      }
    }

    const finalMessage = await stream.finalMessage()
    stopReason = finalMessage.stop_reason

    // Append assistant message (preserving tool_use blocks) to history.
    conversation.push({
      role: 'assistant',
      content: finalMessage.content as unknown as ContentBlock[],
    })

    if (finalMessage.stop_reason !== 'tool_use') break

    // Execute all tool_use blocks; collect tool_result blocks for the next user turn.
    const toolUses = finalMessage.content.filter(b => b.type === 'tool_use') as Array<{
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }>

    const toolResults: ContentBlock[] = []
    for (const tu of toolUses) {
      try {
        const result = await executeTool(tu.name, tu.input ?? {}, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        })
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `error: ${(err as Error).message ?? String(err)}`,
          is_error: true,
        })
      } finally {
        emit({ event: 'tool_end', data: { id: tu.id } })
      }
    }

    conversation.push({ role: 'user', content: toolResults })
  }

  return { finalMessages: conversation, stopReason, iterations }
}
