// Restore exercise for the local or self-hosted stack: dump the running
// database with pg_dump inside the Supabase container, restore it into a
// fresh disposable database, verify the application schemas in the copy,
// then drop the copy. Never touches the source database. Requires Docker on
// PATH and the local stack running (npm run db:start).
//
// The verdict is APPLICATION RESTORE CHECK PASSED only when the restore
// process produced nothing but known platform limitations and public plus
// komisio_private match the source in table names, row counts and object
// definitions. Raw pg_restore output, error details and row data are never
// printed; see scripts/backup-verification.mjs for what is compared.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import {
  APPLICATION_SCHEMAS,
  classifyRestore,
  cleanupCopy,
  compareInventory,
  compareTableCounts,
  verdictLines,
} from './backup-verification.mjs'

const container = process.env.KOMISIO_DB_CONTAINER ?? 'supabase_db_komisio'
const connectionString =
  process.env.KOMISIO_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const copy = `komisio_restore_${randomUUID().replaceAll('-', '')}`
const dump = `/tmp/${copy}.dump`
const docker = (...args) =>
  spawnSync('docker', ['exec', container, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

const schemas = APPLICATION_SCHEMAS.map((s) => `'${s}'`).join(',')
// Counts as text so that bigint values never pass through a double.
const countsSql = `select n.nspname as schema, c.relname as "table",
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text as n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (${schemas}) and c.relkind='r' order by 1,2`
// Stable identities with definition digests for every application object kind.
const inventorySql = `
  select 'function' as kind, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as identity,
    md5(p.prosrc||'|'||coalesce(p.proconfig::text,'')||'|'||p.prosecdef::text||'|'||p.provolatile||'|'||pg_get_function_result(p.oid)) as digest
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (${schemas})
  union all
  select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)||'|'||t.tgenabled)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in (${schemas})
  union all
  select 'policy', n.nspname||'.'||c.relname||'.'||p.polname,
    md5(p.polcmd::text||'|'||p.polpermissive::text||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||'|'||
      coalesce((select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r where r.oid = any(p.polroles)),'public'))
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemas})
  union all
  select 'constraint', n.nspname||'.'||coalesce(c.relname,'')||'.'||x.conname, md5(pg_get_constraintdef(x.oid))
  from pg_constraint x join pg_namespace n on n.oid=x.connamespace left join pg_class c on c.oid=x.conrelid where n.nspname in (${schemas})
  union all
  select 'index', n.nspname||'.'||c.relname, md5(pg_get_indexdef(c.oid))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='i' and n.nspname in (${schemas})
  union all
  select 'rls', n.nspname||'.'||c.relname, c.relrowsecurity::text||'|'||c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in (${schemas})
  union all
  select 'table_grants', g.table_schema||'.'||g.table_name,
    md5(string_agg(g.grantee||':'||g.privilege_type, ',' order by g.grantee, g.privilege_type))
  from information_schema.role_table_grants g where g.table_schema in (${schemas}) group by 1,2
  union all
  select 'routine_grants', g.specific_schema||'.'||g.specific_name,
    md5(string_agg(g.grantee||':'||g.privilege_type, ',' order by g.grantee, g.privilege_type))
  from information_schema.role_routine_grants g where g.specific_schema in (${schemas}) group by 1,2
  order by 1,2`

const admin = new pg.Client({ connectionString })
await admin.connect()
const started = Date.now()
let restored = null
let primaryError = null
let result = null
try {
  const dumped = docker(
    'pg_dump',
    '-U',
    'postgres',
    '-Fc',
    '-f',
    dump,
    'postgres',
  )
  if (dumped.status !== 0)
    throw new Error(`pg_dump failed with status ${dumped.status ?? 'none'}`)
  await admin.query(`create database "${copy}"`)
  const restore = docker(
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
  const url = new URL(connectionString)
  url.pathname = `/${copy}`
  restored = new pg.Client({ connectionString: url.toString() })
  await restored.connect()
  // The vault data entry is a platform limitation only when there is nothing
  // to lose: both tables must read as empty; an unreadable table counts as
  // not verified.
  const vaultEmptyIn = async (client) => {
    try {
      const r = await client.query(
        'select count(*)::text as n from vault.secrets',
      )
      return r.rows[0]?.n === '0'
    } catch {
      return null
    }
  }
  const [vaultSource, vaultCopy] = [
    await vaultEmptyIn(admin),
    await vaultEmptyIn(restored),
  ]
  const vaultEmpty =
    vaultSource === null || vaultCopy === null ? null : vaultSource && vaultCopy
  const restoreVerdict = classifyRestore({
    status: restore.status,
    stderr: restore.stderr,
    vaultEmpty,
  })
  const [sourceCounts, copyCounts, sourceInventory, copyInventory] = [
    (await admin.query(countsSql)).rows,
    (await restored.query(countsSql)).rows,
    (await admin.query(inventorySql)).rows,
    (await restored.query(inventorySql)).rows,
  ]
  result = verdictLines({
    restore: restoreVerdict,
    tables: compareTableCounts(sourceCounts, copyCounts),
    inventory: compareInventory(sourceInventory, copyInventory),
    seconds: Math.round((Date.now() - started) / 1000),
  })
} catch (e) {
  primaryError = e
} finally {
  const cleanupErrors = await cleanupCopy({ restored, admin, copy })
  const removed = docker('rm', '-f', dump)
  if (removed.status !== 0) cleanupErrors.push('removing the dump file failed')
  try {
    await admin.end()
  } catch {
    cleanupErrors.push('closing the admin session failed')
  }
  if (result) for (const line of result.lines) console.log(line)
  if (primaryError)
    console.log(
      `APPLICATION RESTORE CHECK FAILED: ${primaryError instanceof Error ? primaryError.message : 'error'}`,
    )
  for (const line of cleanupErrors) console.log(`CLEANUP: ${line}`)
  process.exit(
    result?.passed && !primaryError && cleanupErrors.length === 0 ? 0 : 1,
  )
}
