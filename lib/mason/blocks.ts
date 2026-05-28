import type { Block } from '../types'

// SSE event types streamed from /api/chat and /api/inbox/reply.
export type StreamEvent =
  | { event: 'session'; data: { sessionId: string } }
  | { event: 'text_start'; data: { id: string } }
  | { event: 'text_delta'; data: { id: string; text: string } }
  | { event: 'text_end'; data: { id: string } }
  | { event: 'block'; data: { id: string } & Block }
  | { event: 'tool_start'; data: { id: string; name: string } }
  | { event: 'tool_end'; data: { id: string } }
  | { event: 'done'; data: { turnCount?: number } }
  | { event: 'error'; data: { code: number; type: string; message: string; retry: boolean } }
  | { event: 'debug'; data: Record<string, unknown> }

export function serializeSSE(evt: StreamEvent): string {
  return `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
}

export type Emit = (evt: StreamEvent) => void
