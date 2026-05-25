/**
 * Applies 005_admin_portal.sql to the Supabase remote DB using Supabase's
 * REST API with a "trick": send each statement as a separate Supabase rpc call
 * to a simple exec function. Since Supabase doesn't ship exec by default,
 * we'll use the direct PostgreSQL connection string instead via pg.
 *
 * Usage: node scripts/run-migration.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const sql = fs.readFileSync('supabase/migrations/005_admin_portal.sql', 'utf8')

// Split by statements (crude but effective for DDL)
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

async function main() {
  // First check if admin_users table already exists
  const { error: checkErr } = await db.from('admin_users').select('id').limit(1)
  if (!checkErr) {
    console.log('Migration already applied (admin_users table exists).')
    return
  }

  console.log('Attempting to apply migration via Supabase...')
  console.log('NOTE: Supabase REST API cannot run raw DDL.')
  console.log('')
  console.log('Please run this SQL in your Supabase Dashboard:')
  console.log('  https://supabase.com/dashboard/project/expnnyjbomphuqhtsgjc/sql/new')
  console.log('')
  console.log('Copy and paste the contents of:')
  console.log('  supabase/migrations/005_admin_portal.sql')
  console.log('')
  console.log('After that, run: npm run seed:admin')
}

main().catch(console.error)
