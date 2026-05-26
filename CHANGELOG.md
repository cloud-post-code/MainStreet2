# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1.0] - 2026-05-26

### Fixed
- **Chat API 404 in production** — `export const runtime = 'edge'` caused Vercel's Edge Network to silently fail on `@supabase/supabase-js` initialization, returning 404 for every `POST /api/chat`. Converted to a standard Node.js serverless handler (`NextApiRequest`/`NextApiResponse`) with SSE streaming via `res.write()`. Chat now works on hosted environments.

### Changed
- **Richer product search embeddings** — embedded text for each product now includes business name, product name, description, and price (was name + description only). Searches like "candles from [shop name]" or "gifts under $30" produce better matches. Existing products need a re-scrape to pick up the new embeddings.

## [0.1.0.1] - 2026-05-25

### Fixed
- **Product cards now appear in chat** — the `products` SSE event was never emitted from the API, so the product strip UI was dead code. Cards now render after Mason recommends items.
- **Products are suppressed while Mason is asking questions** — the `products` event only fires when Mason's response does not end with `?`, preventing premature card display during clarification turns.
- **Mason can no longer hallucinate products** — system prompt updated with explicit DATABASE-ONLY RULE: Mason may only reference products from the injected search results, never invent or guess items.

### Changed
- **Mason's guidance flow** — prompt restructured to ask one focused clarifying question when a request is vague (who/budget/occasion), then recommend on the next turn. Never asks two questions in a row.
- **Recommendations capped at 3–4 products** — search result limit reduced from 5 to 4 to match the intended UX of a focused recommendation list.
- **Recommendation format** — Mason now names shop, item, and one sentence on why it fits the customer's need for each product.
