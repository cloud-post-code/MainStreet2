# Getting Started with Main Street

You'll run the full Main Street stack locally — the AI chat UI, the admin portal, and the product search — in about 5 minutes. By the end you'll have Mason responding to shopping queries with products from the database.

## What you'll need

- Node.js 18+
- A Supabase project with the pgvector extension enabled
- An OpenAI API key (for chat and embeddings)
- A Stripe account (for checkout — test mode is fine)

## Step 1: Clone and install

```bash
git clone https://github.com/cloud-post-code/MainStreet2.git main-street
cd main-street
npm install
```

You'll see `added N packages`. If you see errors about Playwright, that's fine — it's only needed for the scraper, not the dev server.

## Step 2: Set up environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

```env
OPENAI_API_KEY=sk-...              # Required — used for chat (gpt-4o) and embeddings
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Service role key, not anon key
STRIPE_SECRET_KEY=sk_test_...      # Test mode key works fine
STRIPE_WEBHOOK_SECRET=whsec_...    # From Stripe dashboard → Webhooks
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXTAUTH_SECRET=any-random-32-char-string
FINGERPRINT_ENFORCEMENT=off        # Set to "off" for local development
```

Leave `VERCEL_ENV` unset locally — its absence enables debug mode on the chat endpoint.

## Step 3: Run database migrations

In your Supabase project, open the SQL editor and run each migration in order:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_conversations.sql
supabase/migrations/003_orders_stripe.sql
supabase/migrations/004_match_products_rpc.sql
supabase/migrations/005_admin_portal.sql
supabase/migrations/005_inbox_threads.sql
```

Each file is idempotent — safe to re-run.

## Step 4: Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000`. You'll see Mason's landing card.

## Step 5: Talk to Mason

Type a shopping request:

> A birthday gift for my sister who loves cooking

Mason will:
1. Run a semantic search against your products table (which is empty right now)
2. Reply asking for clarification or present results

With an empty database, Mason will still respond — he'll ask clarifying questions or apologize gracefully. To see real results, [add your first business](howto-add-business.md).

## Step 6: Create an admin account

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/seed-admin.ts
```

This creates an admin user. Then visit `http://localhost:3000/admin` and log in.

## What you built

A running instance of Main Street with:
- Mason AI chat at `http://localhost:3000`
- Session history at `http://localhost:3000/history`
- Admin portal at `http://localhost:3000/admin`

Next: [Add a local business and scrape its catalog](howto-add-business.md).
