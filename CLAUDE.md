# Main Street — Local Personal Shopper

## Project overview

**Main Street** is a Next.js 14 app that acts as a local personal shopper. Users describe what they need and an AI assistant ("Mason") finds it from local businesses in the area.

- Dev server: `http://localhost:3000`
- Stack: Next.js 14, TypeScript, Supabase, Anthropic Claude SDK, Stripe, NextAuth
- Project root: `/Users/christophermauri/Downloads/main-street`

## Running the dev server

```bash
cd /Users/christophermauri/Downloads/main-street
npm run dev
```

## Key directories

- `pages/` — Next.js pages (`index.tsx` is the main chat UI)
- `pages/api/` — API routes
- `pages/admin/` — Admin panel
- `components/` — React components
- `lib/` — Shared utilities and types
- `scripts/` — Data scraping scripts (Playwright-based)
- `supabase/` — DB migrations and config

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
