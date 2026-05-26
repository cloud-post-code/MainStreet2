export interface OpenAIToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: object }
}

export const MASON_TOOLS: OpenAIToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Search the local product catalog with one or more semantic queries. Use 2–4 varied queries (synonyms, broader categories, specific descriptors) to maximize recall.',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
            description:
              'Semantically varied search queries. E.g. ["blue denim jacket men", "casual jacket outerwear", "denim trucker jacket"]',
          },
          limit_per_query: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            default: 5,
            description: 'Max results per query before deduplication. Default 5.',
          },
        },
        required: ['queries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_businesses',
      description:
        'Search for local shops by name, type, or specialty. Use when the customer asks about a specific store or what kinds of shops carry something.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Business name, type, or specialty. E.g. "bakery", "The Copper Kettle", "gift shop"',
          },
          town: {
            type: 'string',
            description: 'Optional: filter by town name.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_cards',
      description:
        'Render product and/or business cards in the customer UI. Call this after searching to show your curated picks. Be selective — only include items you are recommending in your message.',
      parameters: {
        type: 'object',
        properties: {
          product_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of products to render.',
          },
          business_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of businesses to render.',
          },
        },
      },
    },
  },
]
