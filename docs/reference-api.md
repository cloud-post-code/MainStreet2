# API Reference

All endpoints are Next.js API routes. Chat routes run on Edge runtime; admin routes run on Node runtime.

---

## POST /api/chat

Streams a Mason response over Server-Sent Events. Edge runtime.

### Request

```json
{
  "message": "A birthday gift for my sister who loves cooking",
  "sessionId": "uuid (optional — omit to start a new session)"
}
```

### Response

`Content-Type: text/event-stream`

Events are emitted in order:

| Event | Payload | When |
|-------|---------|------|
| `session` | `{ sessionId: string }` | First message only — store this |
| `debug` | `{ derivedQuery: string, productCount: number }` | Non-production + `?debug=1` only |
| `delta` | `{ text: string }` | Each streamed token from GPT-4o |
| `done` | `{ turnCount: number }` | After full response written to DB |
| `error` | `ChatErrorEvent` | On any failure |

#### ChatErrorEvent shape

```ts
{
  code: number        // HTTP-style status code
  type: ChatErrorCode // see below
  message: string
  retry: boolean      // if true, the client can retry immediately
}
```

#### ChatErrorCode values

| Code | Meaning |
|------|---------|
| `turn_limit_exceeded` | Session has reached 8 turns. Start a new session. |
| `session_expired` | Session's 24-hour TTL has passed. |
| `session_not_found` | Session ID doesn't exist or fingerprint mismatch. |
| `version_conflict` | Concurrent update detected — retry the request. |
| `fingerprint_mismatch` | Browser/IP changed mid-session. |
| `internal_error` | Unclassified server error. |

### Session lifecycle

- Sessions expire 24 hours after their last message (TTL is extended on each turn).
- Maximum 8 turns per session (`TURN_LIMIT`).
- Sessions are identified by a UUID returned in the first `session` event. Store it in `localStorage`.

---

## POST /api/search

Semantic product search without the chat layer. Useful for testing.

### Request

```json
{ "query": "cast iron skillet" }
```

### Response

```json
{
  "results": [
    {
      "id": "uuid",
      "business_id": "uuid",
      "business_name": "The Kitchen Collective",
      "name": "Lodge 10-inch Cast Iron Skillet",
      "price": 34.99,
      "url": "https://...",
      "image_url": "https://... (nullable)",
      "last_seen": "2025-05-01T12:00:00Z",
      "similarity": 0.91
    }
  ]
}
```

---

## POST /api/checkout

Creates a Stripe Checkout Session for one or more products.

### Request

```json
{
  "items": [
    { "productId": "uuid", "quantity": 1 }
  ],
  "conversationId": "uuid",
  "successUrl": "https://yourdomain.com/success",
  "cancelUrl": "https://yourdomain.com/"
}
```

### Response

```json
{ "url": "https://checkout.stripe.com/..." }
```

Redirect the user to `url`. On completion, Stripe posts to `/api/webhooks/stripe`.

---

## GET /api/history/sessions

Returns the current user's conversation sessions, identified by session fingerprint.

### Response

```json
{
  "sessions": [
    {
      "id": "uuid",
      "messages": [...],
      "turn_count": 3,
      "expires_at": "2025-05-26T10:00:00Z",
      "created_at": "2025-05-25T10:00:00Z"
    }
  ]
}
```

---

## POST /api/history/continue

Creates a fresh conversation seeded with the messages from an existing session. Used to "continue" a session from the history page without reusing the old (potentially fingerprint-locked) session ID.

### Request

```json
{ "sessionId": "uuid" }
```

### Response

```json
{ "sessionId": "new-uuid" }
```

---

## GET /api/inbox/threads

Returns inbox message threads for the current user.

### Response

```json
{
  "threads": [
    {
      "id": "uuid",
      "subject": "You might like this...",
      "thread_type": "recommendation",
      "read_at": null,
      "last_activity_at": "2025-05-25T09:00:00Z"
    }
  ]
}
```

---

## POST /api/inbox/reply

Sends a reply to an inbox thread.

### Request

```json
{ "threadId": "uuid", "message": "Yes, I'd love to see more like this." }
```

---

## POST /api/inbox/mark-read

Marks a thread as read.

### Request

```json
{ "threadId": "uuid" }
```

---

## Admin endpoints (require NextAuth session)

All `/api/admin/*` routes return 401 without a valid session cookie.

### Businesses

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/companies` | List all businesses (paginated) |
| `POST` | `/api/admin/companies` | Create a business |
| `GET` | `/api/admin/companies/[id]` | Get a business |
| `PATCH` | `/api/admin/companies/[id]` | Update a business |
| `DELETE` | `/api/admin/companies/[id]` | Delete a business |
| `POST` | `/api/admin/companies/batch` | Batch import businesses (CSV-style JSON array) |

### Products

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/products` | List products (filterable by business, status) |
| `POST` | `/api/admin/products` | Create a product manually |
| `GET` | `/api/admin/products/[id]` | Get a product |
| `PATCH` | `/api/admin/products/[id]` | Update a product (locks the field from scraper overwrite) |
| `DELETE` | `/api/admin/products/[id]` | Delete a product |
| `POST` | `/api/admin/products/batch` | Batch import products |

---

## POST /api/webhooks/stripe

Stripe sends events here after payment events. Signature verified with `STRIPE_WEBHOOK_SECRET`.

Handled events:
- `checkout.session.completed` — updates the order status to `purchased`

---

## Related

- [Database Schema](reference-schema.md) — underlying data shapes
- [Architecture](explanation-architecture.md) — why the chat endpoint uses SSE/Edge
