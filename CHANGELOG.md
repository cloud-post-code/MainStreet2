# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0.2] - 2026-05-28

### Fixed
- **Mason now finds products even when embeddings are missing.** Products created via the admin panel were inserted with `embedding = NULL`. The `match_products` Postgres RPC silently drops all rows where the cosine distance is NULL (any arithmetic with NULL evaluates to false), so the entire catalog appeared empty to Mason's `search_products` tool. Fixed by adding a keyword `ilike` fallback search in `lib/search.ts` that runs when vector search returns zero results — Mason can now find all products regardless of embedding status. Admin-created products now also have embeddings generated at insert time (and regenerated on name/description update) so semantic search catches them too.

## [0.2.0.1] - 2026-05-28

### Fixed
- **Production deploy of v0.2.0.0 was broken** — `pages/api/inbox/reply.ts` still used `export const runtime = 'edge'` while transitively importing `@anthropic-ai/sdk`, which calls `process.platform` / `process.getuid`. Next.js compiled with "A Node.js API is used … not supported in the Edge Runtime" warnings and Vercel failed the deploy. Converted the inbox responder to a Node.js serverless API route (same shape as `pages/api/chat.ts`). Inbox replies now build and ship.

## [0.2.0.0] - 2026-05-28

### Changed
- **Mason is now an agent.** The hardcoded gpt-4o brain (always-search heuristic, single-shot response, no memory) is replaced with an Anthropic Claude Sonnet 4.6 tool-use loop. Mason plans first, decides which tools to call, can search products and shops, fetch hours and address details, recall past customer context, and render typed UI blocks. The frontend chat shell, design tokens, session/turn-limit plumbing, OpenAI product embeddings, and Supabase data layer are unchanged.
- **Mason in the inbox uses the same agent.** `pages/api/inbox/reply.ts` now runs the shared agent in `mode: 'inbox'` so proactive thread replies get the same tool access (search, shop lookup, customer context) instead of a separate prompt.
- **Conversation history now stores tool calls.** `conversations.messages` JSONB persists the full Anthropic-shaped message chain — text, `tool_use`, and `tool_result` blocks — so multi-turn sessions resume mid-loop correctly. Old string-content rows still load.

### Added
- **Visible planning.** Mason emits a `plan` UI block before non-trivial requests so customers see the route he intends to take.
- **Long-term customer memory.** New `recall_customer_context` tool joins recent orders, top preference signals (viewed / dismissed / purchased), and recent search topics for the resolved customer id. Authenticated users see their own history; fingerprinted sessions see their own.
- **Preference signal logging.** New `record_preference` tool writes to `customer_preference_signals` when Mason notices a customer like, dismiss, or purchase intent, so future sessions get smarter.
- **Shop search and lookup.** New `lib/shops.ts` (`searchShops`, `getShopById`) plus `search_shops`, `get_shop_details`, and `show_shop` tools — Mason can answer "where do I find X" and surface a shop card with address.
- **Typed UI block protocol.** SSE now streams `text_start` / `text_delta` / `text_end` / `block` events. Blocks: `plan`, `question` (with tappable chip options), `product_strip`, `shop_card`. Frontend renders each by type instead of parsing ad-hoc events.
- **Filtered product search.** `searchProducts(query, filters)` accepts `min_price`, `max_price`, `business_id`, `limit`. Internally pulls a wider net when filtering so post-filter doesn't starve the agent.
- **Product hydration helper.** `getProductsByIds` rehydrates `show_products` cards from the database so Mason cannot fabricate a card payload — he only passes ids.

### Removed
- **`deriveSearchQuery`** — the model now forms its own search queries via tool args, so the separate gpt-4o-mini extraction call is gone.
- **`shouldSearch` heuristic** and the always-true gate it replaced — searches happen when Mason decides to, not on every turn.

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
