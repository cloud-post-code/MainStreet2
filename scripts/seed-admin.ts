/**
 * Creates the initial admin user.
 * Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=yourpass ts-node --project tsconfig.json scripts/seed-admin.ts
 */
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { config } from 'dotenv'
config({ path: '.env.local' })

const email = process.env.ADMIN_EMAIL ?? 'admin@mainstreet.local'
const password = process.env.ADMIN_PASSWORD ?? 'changeme123'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env vars')

  const db = createClient(url, key, { auth: { persistSession: false } })
  const hash = await bcrypt.hash(password, 12)

  const { data, error } = await db
    .from('admin_users')
    .upsert({ email: email.toLowerCase(), password_hash: hash, name: 'Admin' }, { onConflict: 'email' })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to seed admin user:', error.message)
    process.exit(1)
  }

  console.log(`Admin user created/updated: ${email} (id: ${data.id})`)

  // Always ensure a default dev admin account exists
  const devHash = await bcrypt.hash('admin123', 12)
  const { error: devError } = await db
    .from('admin_users')
    .upsert(
      { email: 'admin@admin.com', password_hash: devHash, name: 'Admin' },
      { onConflict: 'email' }
    )
    .select('id')
    .single()
  if (devError) {
    console.error('Failed to seed default dev admin:', devError.message)
  } else {
    console.log('Default dev admin ensured: admin@admin.com / admin123')
  }

  console.log(`Login at http://localhost:3000/admin/login`)
}

main().catch(console.error)
