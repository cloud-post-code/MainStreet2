import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { Client } from 'pg'
import { config } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

config({ path: path.join(__dirname, '../.env.local') })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set in .env.local')
  process.exit(1)
}

const MIGRATIONS_DIR = path.join(__dirname, '../supabase/migrations')

async function run() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  // Create migrations tracking table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  const applied = new Set(
    (await client.query('SELECT name FROM _migrations ORDER BY name')).rows.map((r: { name: string }) => r.name)
  )

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  // On first run, the _migrations table is empty but migrations were already applied
  // manually. Check if the core tables exist — if so, mark all files that predate
  // the current unapplied ones as already done so we don't re-run them.
  // Strategy: any file already recorded in _migrations is skipped; anything not
  // recorded gets run. The caller should delete _migrations rows for files that
  // truly need re-running.

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`)
      continue
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    console.log(`  run   ${file}`)
    await client.query(sql)
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
    ran++
  }

  await client.end()
  console.log(ran === 0 ? '\nAll migrations already applied.' : `\n${ran} migration(s) applied.`)
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
