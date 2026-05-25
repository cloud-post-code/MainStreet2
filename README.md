# Main Street

**Your local personal shopper.** Describe what you need and Mason — an AI assistant — finds it from curated local businesses you can trust.

Built with Next.js 14, GPT-4o, pgvector (Supabase), and Stripe.

---

## Quick start

```bash
git clone https://github.com/cloud-post-code/MainStreet2.git main-street
cd main-street
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                   # http://localhost:3000
```

See the **[Getting Started tutorial](docs/tutorial-getting-started.md)** for the full setup including database migrations and admin account creation.

## Documentation

| | |
|--|--|
| [Getting Started](docs/tutorial-getting-started.md) | Install, configure, and run locally |
| [Architecture](docs/explanation-architecture.md) | How the system is built and why |
| [Mason AI Agent](docs/explanation-mason.md) | How the AI shopper works |
| [API Reference](docs/reference-api.md) | All endpoints and their payloads |
| [Database Schema](docs/reference-schema.md) | Tables, indexes, and the vector search RPC |
| [Add a Business](docs/howto-add-business.md) | Onboard a shop and scrape its catalog |
| [Admin Portal](docs/howto-admin.md) | Manage businesses, products, and orders |
| [Fingerprinting](docs/howto-fingerprinting.md) | Configure session security |

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, React 18, TypeScript |
| AI | GPT-4o (chat), GPT-4o-mini (query extraction), text-embedding-3-small |
| Database | Supabase (Postgres + pgvector) |
| Auth | NextAuth.js (admin portal only) |
| Payments | Stripe Checkout |
| Scraper | Playwright (headless Chromium) |
| Hosting | Vercel (Edge runtime for `/api/chat`) |

## Environment variables

See [`.env.example`](.env.example) for all required variables. Required at minimum:

```
OPENAI_API_KEY
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXTAUTH_SECRET
```

## Adding local businesses

```bash
npm run scrape -- \
  --business-id "uuid-from-admin" \
  --name "The Kitchen Collective" \
  --urls "https://shopname.com/collections/all"
```

Full instructions: [How to Add a Business](docs/howto-add-business.md).
