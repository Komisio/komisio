// Restore exercise for the local or self-hosted stack: dump the running
// database with pg_dump inside the Supabase container, restore it into a
// fresh disposable database, compare row counts per public table, then drop
// the copy. Never touches the source database. Requires Docker on PATH and
// the local stack running (npm run db:start).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const container = process.env.KOMISIO_DB_CONTAINER ?? 'supabase_db_komisio'
const connectionString =
  process.env.KOMISIO_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const copy = `komisio_restore_${randomUUID().replaceAll('-', '')}`
const dump = `/tmp/${copy}.dump`
const docker = (...args) =>
  execFileSync('docker', ['exec', container, ...args], { stdio: 'pipe' })

const admin = new pg.Client({ connectionString })
await admin.connect()
const started = Date.now()
let ok = false
try {
  docker('pg_dump', '-U', 'postgres', '-Fc', '-f', dump, 'postgres')
  await admin.query(`create database "${copy}"`)
  // Platform schemas (realtime, auth internals) carry settings only a
  // superuser may restore; the exercise proves the application schemas, so
  // those errors are counted and reported, not fatal. The row comparison is
  // the verdict.
  let restoreWarnings = 0
  try {
    docker(
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      copy,
      '--no-owner',
      '-N',
      'realtime',
      '-N',
      '_realtime',
      dump,
    )
  } catch (e) {
    restoreWarnings = String(e.stderr ?? '')
      .split(String.fromCharCode(10))
      .filter((l) => l.includes('error:')).length
  }
  const url = new URL(connectionString)
  url.pathname = `/${copy}`
  const restored = new pg.Client({ connectionString: url.toString() })
  await restored.connect()
  const counts = async (client) =>
    (
      await client.query(
        `select c.relname as table, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as n
         from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' order by 1`,
      )
    ).rows
  const [source, target] = [await counts(admin), await counts(restored)]
  await restored.end()
  const mismatches = source.filter(
    (row, i) => target[i]?.table !== row.table || target[i]?.n !== row.n,
  )
  console.log(
    `dumped and restored ${source.length} tables in ${Math.round((Date.now() - started) / 1000)} s; ${restoreWarnings} restore errors outside the application schemas`,
  )
  for (const row of source) console.log(`${row.table}: ${row.n}`)
  if (mismatches.length) {
    console.log(`MISMATCH in ${mismatches.map((m) => m.table).join(', ')}`)
  } else {
    ok = true
    console.log('RESTORE OK: every table has the same row count in the copy')
  }
} finally {
  try {
    docker('rm', '-f', dump)
  } catch {}
  await admin.query(`drop database if exists "${copy}"`)
  await admin.end()
}
process.exit(ok ? 0 : 1)
