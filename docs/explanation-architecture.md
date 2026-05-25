# Architecture

Main Street connects a conversational AI frontend to a vector-searchable product catalog backed by Supabase. Here's how the pieces fit together and why they're built this way.

## System diagram

```
User browser
    │
    ▼
Next.js pages (React)
  ├── / (chat UI)
  ├── /history
  ├── /inbox
  └── /admin/*
    │
    ▼
Next.js API routes
  ├── /api/chat          ← Edge runtime, streams SSE
  ├── /api/search
  ├── /api/checkout
  ├── /api/history/*
  ├── /api/inbox/*
  ├── /api/admin/*       ← Node runtime, NextAuth-gated
  └── /api/webhooks/stripe
    │
    ├── OpenAI API        ← gpt-4o (chat), gpt-4o-mini (query extraction), text-embedding-3-small
    ├── Supabase          ← Postgres + pgvector + Row Level Security
    └── Stripe            ← Checkout Sessions, webhooks

Scraper (offline, CLI)
  └── npm run scrape → Playwright → OpenAI embeddings → Supabase
```

## The chat endpoint is Edge runtime

`/api/chat` runs on Vercel's Edge runtime (`export const runtime = 'edge'`). This means it's a V8 isolate — no Node.js built-ins, no cold starts, and the response is a streaming `ReadableStream` over Server-Sent Events (SSE).

The tradeoff: no `node:crypto`, no `node:fs`, no native addons. The fingerprint hash uses `crypto.subtle.digest` (Web Crypto) instead of Node's `crypto.createHash`. The Supabase client uses `@supabase/supabase-js` REST mode (`auth: { persistSession: false }`), which works fine in V8 environments.

## Semantic search, not keyword search

Product search is powered by pgvector's cosine similarity. The flow on every chat turn:

```
User message + conversation history
    │
    ▼
gpt-4o-mini extracts a clean search query (≤20 words)
    │
    ▼
text-embedding-3-small produces a 1536-dim vector
    │
    ▼
match_products RPC: cosine similarity > 0.75, top 5
    │
    ▼
Results injected into Mason's context as a user-role message
```

Keyword search fails for shopping: "something to make pasta" won't match products named "KitchenAid pasta attachment." Cosine similarity on embeddings solves this — the query and the product description are in the same semantic space.

The `shouldSearch` function (`lib/search.ts`) decides when to run a search. It always searches on turn 0 and turn 2+, and skips if Mason ended the last response with a question (collecting more info).

## Conversations use optimistic concurrency

Each row in the `conversations` table has a `version` integer. The chat handler reads the row, computes the new state, and updates with:

```sql
UPDATE conversations SET ... WHERE id = $1 AND version = $current_version
```

If another request updated the row between read and write, the version won't match and the update returns 0 rows. The handler emits a `version_conflict` SSE event with `retry: true`. This prevents message loss if two browser tabs send simultaneously.

## Session fingerprinting

When a conversation starts, the server hashes `user-agent + ip` with SHA-256 to produce a `session_fingerprint`. Subsequent requests must present the same fingerprint (or the stored `sessionId`). This prevents session hijacking via sessionId leakage — a session can't be replayed from a different device.

Three modes via `FINGERPRINT_ENFORCEMENT`:
- `strict` — exact match required
- `relaxed` — first 16 hex chars must match (handles dynamic IPs)
- `off` — no fingerprint check (use for local dev and automated tests)

## The scraper runs offline

`lib/scraper.ts` uses Playwright (headless Chromium) to crawl shop pages. It's not a production service — it's a CLI tool you run manually or on a cron:

```bash
npm run scrape -- --business-id <uuid> --name "Shop Name" --urls "url1,url2"
```

After scraping, each product is embedded with `text-embedding-3-small` and upserted to Supabase using the product URL as the conflict key. An anomaly guard warns if the product count drops >40% (scrape failure detection).

## The admin portal uses NextAuth JWT sessions

`/admin/*` pages call `requireAdminSession()` in `getServerSideProps`. This reads the NextAuth session cookie and redirects to `/admin/login` if missing. The auth backend checks `admin_users` in Supabase with bcrypt-hashed passwords. Login failures are rate-limited: 5 failures per IP per 15 minutes, in-memory.

## Related

- [API Reference](reference-api.md) — every endpoint, parameters, and responses
- [Database Schema](reference-schema.md) — full table definitions
- [Mason AI Agent](explanation-mason.md) — why Mason's prompt is structured the way it is
