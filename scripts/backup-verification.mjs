// Verdict logic and orchestration for the restore exercise, with every
// external dependency injected so the whole run is unit-testable without a
// database or Docker. Nothing here ever carries raw stderr, error messages,
// command text or row data into results or log lines: only error classes,
// object identifiers, counts, digests and fixed phase names.

export const APPLICATION_SCHEMAS = ['public', 'komisio_private']
export const COPY_NAME = /^komisio_restore_[a-f0-9]{32}$/
// The restore runs inside the container as an existing privileged role that
// can recreate the original ownership; a plain identifier only, passed as its
// own argument, never through a shell.
export const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Parse pg_restore stderr into sanitized entries for diagnosis. Only the
 * error class and the object identifiers are kept; DETAIL, CONTEXT, COPY
 * data and the rest of the command text are dropped here and never leave
 * this function.
 */
export function parseRestoreStderr(stderr) {
  const lines = String(stderr ?? '').split(/\r?\n/)
  const entries = []
  let ignored = null
  let current = null
  for (const line of lines) {
    if (line.startsWith('pg_restore: error:')) {
      current = {
        message: line.includes('permission denied to change default privileges')
          ? 'default_privileges'
          : /permission denied for (table|relation)/.test(line)
            ? 'permission_denied_table'
            : line.includes('permission denied')
              ? 'permission_denied'
              : 'unknown',
        command: { kind: 'unparsed' },
      }
      entries.push(current)
      continue
    }
    const ignoredMatch =
      /^pg_restore: warning: errors ignored on restore: (\d+)/.exec(line)
    if (ignoredMatch) {
      ignored = Number(ignoredMatch[1])
      continue
    }
    if (current && line.startsWith('Command was:')) {
      const acl =
        /^Command was: ALTER DEFAULT PRIVILEGES FOR ROLE ([a-z_][a-z0-9_]*) IN SCHEMA ([a-z_][a-z0-9_]*)/.exec(
          line,
        )
      const copy =
        /^Command was: COPY ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/.exec(line)
      current.command = acl
        ? { kind: 'default_acl', role: acl[1], schema: acl[2] }
        : copy
          ? { kind: 'copy', schema: copy[1], table: copy[2] }
          : { kind: 'other' }
      current = null
    }
  }
  return { entries, ignored }
}

/**
 * Fail-closed classification of a finished pg_restore process. The only
 * passing shape is a normal exit 0 with no error entry and no ignored-error
 * line. Every other status, a missing status (spawn failure), any reported
 * error and any unparsed error line fails; the sanitized entries are
 * summarised for diagnosis, never excused.
 */
export function classifyRestore({ status, stderr }) {
  const failing = []
  const { entries, ignored } = parseRestoreStderr(stderr)
  if (status === null || status === undefined)
    failing.push({ class: 'restore process reported no exit status' })
  else if (status !== 0)
    failing.push({ class: `restore exited with status ${status}` })
  if (ignored !== null)
    failing.push({ class: `restore reported ${ignored} ignored errors` })
  const summary = new Map()
  for (const entry of entries) {
    const c = entry.command
    const object =
      c.kind === 'default_acl'
        ? `default privileges for role ${c.role} in schema ${c.schema}`
        : c.kind === 'copy'
          ? `table data ${c.schema}.${c.table}`
          : c.kind
    const key = `${entry.message === 'unknown' ? 'unclassified restore error' : entry.message} (${object})`
    summary.set(key, (summary.get(key) ?? 0) + 1)
  }
  for (const [description, count] of summary)
    failing.push({ class: description, count })
  return { ok: failing.length === 0, failing }
}

const tableKey = (row) => `${row.schema}.${row.table}`
const digits = (value) => {
  const text = String(value)
  if (!/^\d+$/.test(text)) throw new Error('count is not an integer')
  return BigInt(text).toString()
}

/** Exact table sets in both directions and per-table counts compared as integers of any size. */
export function compareTableCounts(source, copy) {
  const target = new Map(copy.map((row) => [tableKey(row), digits(row.n)]))
  const seen = new Set()
  const missing = []
  const mismatched = []
  for (const row of source) {
    const k = tableKey(row)
    seen.add(k)
    if (!target.has(k)) missing.push(k)
    else if (target.get(k) !== digits(row.n))
      mismatched.push({ table: k, source: digits(row.n), copy: target.get(k) })
  }
  const extra = [...target.keys()].filter((k) => !seen.has(k))
  return {
    ok: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
    tables: seen.size,
    missing: missing.sort(),
    extra: extra.sort(),
    mismatched,
  }
}

/**
 * Privilege rows (one per grantee and privilege, PUBLIC as its own grantee,
 * grant option and grantor included) folded into one digest per object. The
 * identity never contains an OID, so the same object in two databases folds
 * to the same key.
 */
export function grantInventory(rows) {
  const byObject = new Map()
  for (const r of rows) {
    const identity = `${r.schema}.${r.object}`
    const kind = r.kind
    const key = `${kind}:${identity}`
    const list = byObject.get(key) ?? { kind, identity, grants: [] }
    list.grants.push(
      `${r.grantee ?? 'PUBLIC'}:${r.privilege}:${r.grantable ? 'g' : '-'}:${r.grantor}`,
    )
    byObject.set(key, list)
  }
  return [...byObject.values()].map(({ kind, identity, grants }) => ({
    kind,
    identity,
    digest: grants.sort().join(','),
  }))
}

/**
 * Object inventory by stable identity and definition digest. An object of
 * kind 'unsupported' (an aggregate, whose definition this check does not
 * digest) fails the comparison on either side instead of passing unseen.
 */
export function compareInventory(source, copy) {
  const target = new Map(copy.map((o) => [`${o.kind}:${o.identity}`, o.digest]))
  const seen = new Set()
  const missing = []
  const changed = []
  const byKind = {}
  const unsupported = new Set()
  for (const o of [...source, ...copy])
    if (o.kind === 'unsupported') unsupported.add(o.identity)
  for (const o of source) {
    const k = `${o.kind}:${o.identity}`
    seen.add(k)
    byKind[o.kind] = (byKind[o.kind] ?? 0) + 1
    if (!target.has(k)) missing.push(k)
    else if (target.get(k) !== o.digest) changed.push(k)
  }
  const extra = [...target.keys()].filter((k) => !seen.has(k))
  return {
    ok:
      missing.length === 0 &&
      extra.length === 0 &&
      changed.length === 0 &&
      unsupported.size === 0,
    byKind,
    missing: missing.sort(),
    extra: extra.sort(),
    changed: changed.sort(),
    unsupported: [...unsupported].sort(),
  }
}

/** A short error code (SQLSTATE or errno name) or nothing; never a message. */
export const errorCode = (e) =>
  typeof e?.code === 'string' && /^[0-9A-Z_]{2,16}$/.test(e.code)
    ? e.code
    : undefined

/**
 * Close the copy's session, drop the copy only if this run created it and
 * its name is the generated shape, confirm it is gone. Every step runs even
 * when an earlier one failed; errors are returned as fixed phrases, never
 * thrown. The admin session is the caller's to end.
 */
export async function cleanupCopy({ restored, admin, copy, created }) {
  const errors = []
  if (restored) {
    try {
      await restored.end()
    } catch (e) {
      errors.push(
        `closing the copy session failed (${errorCode(e) ?? 'error'})`,
      )
    }
  }
  if (!created || !admin) return errors
  if (!COPY_NAME.test(copy)) {
    errors.push('copy name is not the generated shape; nothing dropped')
    return errors
  }
  try {
    await admin.query(`drop database if exists "${copy}" with (force)`)
  } catch (e) {
    errors.push(`dropping the copy failed (${errorCode(e) ?? 'error'})`)
  }
  try {
    const left = await admin.query(
      'select 1 from pg_database where datname = $1',
      [copy],
    )
    if (left.rowCount > 0) errors.push('the copy still exists after cleanup')
  } catch (e) {
    errors.push(`confirming cleanup failed (${errorCode(e) ?? 'error'})`)
  }
  return errors
}

/** Console lines built only from these results. */
export function verdictLines({ restore, tables, inventory, seconds }) {
  const lines = []
  for (const f of restore.failing)
    lines.push(`RESTORE ERROR: ${f.count ? `${f.count} × ` : ''}${f.class}`)
  lines.push(
    `application tables: ${tables.tables}; missing in copy: ${tables.missing.length}; extra in copy: ${tables.extra.length}; count mismatches: ${tables.mismatched.length}`,
  )
  for (const m of tables.mismatched)
    lines.push(`COUNT MISMATCH ${m.table}: source ${m.source}, copy ${m.copy}`)
  for (const t of tables.missing) lines.push(`MISSING IN COPY ${t}`)
  for (const t of tables.extra) lines.push(`EXTRA IN COPY ${t}`)
  lines.push(
    `application objects: ${Object.entries(inventory.byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(
        ', ',
      )}; missing ${inventory.missing.length}, extra ${inventory.extra.length}, changed ${inventory.changed.length}`,
  )
  for (const o of [
    ...inventory.missing,
    ...inventory.extra,
    ...inventory.changed,
  ].slice(0, 50))
    lines.push(`OBJECT DIFFERENCE ${o}`)
  for (const o of inventory.unsupported ?? [])
    lines.push(`UNSUPPORTED OBJECT ${o}: this check does not verify aggregates`)
  const passed = restore.ok && tables.ok && inventory.ok
  lines.push(
    passed
      ? `APPLICATION RESTORE CHECK PASSED in ${seconds} s: pg_restore exited 0 with no errors; public and komisio_private table names and row counts match; functions, triggers, policies, constraints, indexes, RLS flags and grants match by definition`
      : `APPLICATION RESTORE CHECK FAILED in ${seconds} s`,
  )
  return { passed, lines }
}

const schemaList = APPLICATION_SCHEMAS.map((s) => `'${s}'`).join(',')
// Counts as text so that bigint values never pass through a double.
export const COUNTS_SQL = `select n.nspname as schema, c.relname as "table",
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text as n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (${schemaList}) and c.relkind='r' order by 1,2`
// Definitions by stable identity, owner included; no OID enters an identity or a digest.
export const INVENTORY_SQL = `
  select case when p.prokind='a' then 'unsupported' else 'function' end as kind,
    case when p.prokind='a' then 'aggregate ' else '' end||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as identity,
    case when p.prokind='a' then '' else md5(pg_get_functiondef(p.oid)||'|'||p.proowner::regrole::text) end as digest
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (${schemaList})
  union all
  select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)||'|'||t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in (${schemaList})
  union all
  select 'policy', n.nspname||'.'||c.relname||'.'||p.polname,
    md5(p.polcmd::text||'|'||p.polpermissive::text||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||'|'||
      coalesce((select string_agg(case when r=0 then 'PUBLIC' else r::regrole::text end, ',' order by case when r=0 then 'PUBLIC' else r::regrole::text end) from unnest(p.polroles) r),'PUBLIC'))
  from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemaList})
  union all
  select 'constraint', n.nspname||'.'||coalesce(c.relname,'')||'.'||x.conname, md5(pg_get_constraintdef(x.oid, true))
  from pg_constraint x join pg_namespace n on n.oid=x.connamespace left join pg_class c on c.oid=x.conrelid where n.nspname in (${schemaList})
  union all
  select 'index', n.nspname||'.'||c.relname, md5(pg_get_indexdef(c.oid))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='i' and n.nspname in (${schemaList})
  union all
  select 'table', n.nspname||'.'||c.relname, c.relrowsecurity::text||'|'||c.relforcerowsecurity::text||'|'||c.relowner::regrole::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in (${schemaList})
  order by 1,2`
// Every privilege on application relations and routines, PUBLIC included,
// from the catalog ACLs with owner defaults expanded; folded in JavaScript.
export const GRANTS_SQL = `
  select 'table_grants' as kind, n.nspname as schema, c.relname as object,
    case when a.grantee=0 then null else a.grantee::regrole::text end as grantee,
    a.privilege_type as privilege, a.is_grantable as grantable, a.grantor::regrole::text as grantor
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind='S' then 's' else 'r' end)::"char", c.relowner))) a
  where c.relkind in ('r','v','m','S') and n.nspname in (${schemaList})
  union all
  select 'routine_grants', n.nspname, p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    case when a.grantee=0 then null else a.grantee::regrole::text end,
    a.privilege_type, a.is_grantable, a.grantor::regrole::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in (${schemaList})`

/**
 * The whole exercise with injected dependencies:
 *   spawn(args) → { status, stderr } for a command inside the container;
 *   newClient(database) → { connect(), query(sql, params?), end() };
 *   log(line); copy: generated name; dump: path inside the container;
 *   restoreUser: existing privileged role for pg_restore.
 * Returns the process exit code. Log lines never carry error messages.
 */
export async function runRestoreExercise({
  spawn,
  newClient,
  log,
  copy,
  dump,
  restoreUser,
  now = Date.now,
}) {
  const started = now()
  let admin = null
  let restored = null
  let created = false
  let dumped = false
  let phase = 'configuration'
  let failure = null
  let result = null
  let cleanup = []
  try {
    if (!COPY_NAME.test(copy)) throw new Error('copy name')
    if (!ROLE_NAME.test(restoreUser ?? '')) throw new Error('restore user')
    if (dump !== `/tmp/${copy}.dump`) throw new Error('dump path')
    admin = newClient('postgres')
    phase = 'connect'
    await admin.connect()
    phase = 'dump'
    // Marked before the spawn so a throw after partial output still removes
    // this run's own dump file.
    dumped = true
    const dumpRun = spawn([
      'pg_dump',
      '-U',
      'postgres',
      '-Fc',
      '-f',
      dump,
      'postgres',
    ])
    if (dumpRun.status !== 0) throw new Error('dump')
    phase = 'create copy'
    await admin.query(`create database "${copy}"`)
    created = true
    phase = 'restore'
    const restore = spawn([
      'pg_restore',
      '-U',
      restoreUser,
      '-d',
      copy,
      '-N',
      'realtime',
      '-N',
      '_realtime',
      dump,
    ])
    const restoreVerdict = classifyRestore({
      status: restore.status,
      stderr: restore.stderr,
    })
    phase = 'connect copy'
    restored = newClient(copy)
    await restored.connect()
    phase = 'counts'
    const tables = compareTableCounts(
      (await admin.query(COUNTS_SQL)).rows,
      (await restored.query(COUNTS_SQL)).rows,
    )
    phase = 'inventory'
    const inventory = compareInventory(
      [
        ...(await admin.query(INVENTORY_SQL)).rows,
        ...grantInventory((await admin.query(GRANTS_SQL)).rows),
      ],
      [
        ...(await restored.query(INVENTORY_SQL)).rows,
        ...grantInventory((await restored.query(GRANTS_SQL)).rows),
      ],
    )
    phase = 'verdict'
    result = verdictLines({
      restore: restoreVerdict,
      tables,
      inventory,
      seconds: Math.round((now() - started) / 1000),
    })
  } catch (e) {
    failure = { phase, code: errorCode(e) }
  } finally {
    cleanup = await cleanupCopy({ restored, admin, copy, created })
    if (dumped) {
      let removed
      try {
        removed = spawn(['rm', '-f', dump])
      } catch {
        removed = { status: null }
      }
      if (removed?.status !== 0) cleanup.push('removing the dump file failed')
    }
    if (admin) {
      try {
        await admin.end()
      } catch {
        cleanup.push('closing the admin session failed')
      }
    }
    // The final line is the verdict of the whole run: a passed comparison
    // with a failed cleanup is still a failed run.
    const passed = Boolean(result?.passed) && !failure && cleanup.length === 0
    if (result) {
      const details = result.lines.slice(0, -1)
      for (const line of details) log(line)
      if (passed) log(result.lines.at(-1))
    }
    if (failure)
      log(
        `APPLICATION RESTORE CHECK FAILED: error during ${failure.phase}${failure.code ? ` (${failure.code})` : ''}`,
      )
    for (const line of cleanup) log(`CLEANUP: ${line}`)
    if (!passed && !failure)
      log(
        `APPLICATION RESTORE CHECK FAILED in ${Math.round((now() - started) / 1000)} s${cleanup.length && result?.passed ? ': cleanup failed' : ''}`,
      )
  }
  return Boolean(result?.passed) && !failure && cleanup.length === 0 ? 0 : 1
}
