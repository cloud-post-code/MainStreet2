# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0.1] - 2026-05-25

### Fixed
- **Product cards now appear in chat** — the `products` SSE event was never emitted from the API, so the product strip UI was dead code. Cards now render after Mason recommends items.
- **Products are suppressed while Mason is asking questions** — the `products` event only fires when Mason's response does not end with `?`, preventing premature card display during clarification turns.
- **Mason can no longer hallucinate products** — system prompt updated with explicit DATABASE-ONLY RULE: Mason may only reference products from the injected search results, never invent or guess items.

### Changed
- **Mason's guidance flow** — prompt restructured to ask one focused clarifying question when a request is vague (who/budget/occasion), then recommend on the next turn. Never asks two questions in a row.
- **Recommendations capped at 3–4 products** — search result limit reduced from 5 to 4 to match the intended UX of a focused recommendation list.
- **Recommendation format** — Mason now names shop, item, and one sentence on why it fits the customer's need for each product.
