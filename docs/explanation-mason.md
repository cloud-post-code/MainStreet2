# Mason AI Agent

Mason is the AI personal shopper character that powers Main Street's chat. Here's why he's built the way he is.

## The problem with generic AI chat for shopping

A generic AI assistant given a product catalog will summarize, list, and explain — but it won't _shop_. It tends to:
- Ask multiple clarifying questions at once ("What's the occasion? What's your budget? What size? What style?")
- Present products like a database dump, not a recommendation
- Forget what the customer said three turns ago
- Sound like a chatbot, not a person

Mason is designed to fix each of these.

## One clarifying question at a time

The system prompt has an explicit rule:

> Ask at most 1 clarifying question when the request is ambiguous. Never ask 2 questions in a row.

This is the single most important constraint. Two questions in a message feel like a form, not a conversation. One question feels like a curious shopkeeper.

The `shouldSearch` logic (`lib/search.ts`) reinforces this: if Mason's last response ended with a question (`?`), the next turn skips product search. Mason uses that turn to absorb the answer before searching. This prevents wasting search capacity on mid-question turns.

## Search triggers, not keyword matching

Mason doesn't search every turn. `shouldSearch` returns true when:
- It's turn 0 (always search on first message)
- It's turn 2 or higher (search regularly through the conversation)
- Mason's last message wasn't a question

On turns where Mason is collecting information (question turns), search is skipped.

The search itself uses GPT-4o-mini to extract a clean query from the full conversation transcript, then embeds that query to find semantically similar products. This handles natural language: "something for someone who likes to cook" → "cooking kitchen tools" → finds matching products.

## Why GPT-4o, not a smaller model

The system prompt instructs Mason to "name the shop, name the item" and be "warm and specific." These aren't generic instructions — they require the model to synthesize the product context (injected as a user-role message) with the conversation history and produce a reply that feels hand-written.

GPT-4o-mini handles query extraction (a simple extraction task — 50 tokens max). GPT-4o handles the conversational response where quality matters.

## Product injection via user-role message

The product results are injected into the conversation as:

```json
{
  "role": "user",
  "content": "[Product search results — use these to answer the customer]: [...]"
}
```

Not as a system message, and not by modifying the system prompt. This is intentional:
- System messages set persona and rules. Injecting data there blurs the roles.
- A user-role injection appears as fresh context at the right point in the conversation, right before Mason responds.
- It keeps the system prompt clean and stable across all turns.

## Turn limit

Sessions cap at 8 turns. This is both a cost control and a UX decision: if Mason hasn't found what the customer wants in 8 turns, something is wrong — either the catalog doesn't have it, or the query strategy should be reset. The turn limit forces a restart rather than an endless loop.

At the limit, the UI shows a "See Mason's best picks" button that sends one final search request for the best results found so far.

## Session fingerprinting

Mason doesn't know about users. There's no login. Sessions are anonymous, identified by a SHA-256 fingerprint of the browser's `user-agent + ip`. This fingerprint is stored with the conversation and checked on each subsequent request.

The purpose is anti-abuse, not authentication: it prevents someone from stealing a session ID and continuing a conversation from a different device. It's not meant to be a security boundary for sensitive data (there is none in a shopping session).

## Related

- [API Reference](reference-api.md) — the full `/api/chat` event protocol
- [Architecture](explanation-architecture.md) — why chat runs on Edge runtime
- [Database Schema](reference-schema.md) — the `conversations` table and session lifecycle
