import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'

process.loadEnvFile('.env.local')
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Local Supabase only')
const key =
  process.env.KOMISIO_SELLER_AI_SERVER_KEY?.trim() ||
  randomBytes(32).toString('hex')
if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Invalid server key')
const db = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
})
await db.connect()
try {
  await db.query(
    'insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,$1) on conflict(singleton) do update set key_hash=excluded.key_hash',
    [createHash('sha256').update(key).digest('hex')],
  )
  let content = readFileSync('.env.local', 'utf8')
  for (const [name, value] of Object.entries({
    KOMISIO_SELLER_AI_SERVER_KEY: key,
    KOMISIO_CREDENTIAL_KEY:
      process.env.KOMISIO_CREDENTIAL_KEY?.trim() ||
      randomBytes(32).toString('hex'),
    KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
  })) {
    if (!new RegExp(`^${name}=`, 'm').test(content))
      content += `\n${name}=${value}\n`
    else
      content = content.replace(
        new RegExp(`^${name}=[ \\t]*$`, 'm'),
        () => `${name}=${value}`,
      )
  }
  writeFileSync('.env.local', content, { mode: 0o600 })
  console.log('Local server capability configured. No AI provider key added.')
} finally {
  await db.end()
}
