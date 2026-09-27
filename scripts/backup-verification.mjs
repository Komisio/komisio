// Pure verdict logic for the restore exercise: no database, no process, no
// logging. The exercise script feeds it the restore process result, the
// application table counts and the object inventory of source and copy, and
// prints only what these functions return. Nothing here ever carries raw
// stderr, error details, command text or row data into its results.

export const APPLICATION_SCHEMAS = ['public', 'komisio_private']

// Default-privilege entries observed on the local Supabase stack that a
// restore running as postgres cannot apply because they belong to a platform
// role. They shape privileges of objects created later by that role, not the
// restored application objects, whose grants the inventory comparison covers.
export const PLATFORM_DEFAULT_ACL = {
  supabase_admin: [
    'extensions',
    'graphql',
    'graphql_public',
    'public',
    'supabase_functions',
  ],
  supabase_auth_admin: ['auth'],
}

/**
 * Parse pg_restore stderr into sanitized entries. Only the error class and
 * the object identifiers are kept; DETAIL, CONTEXT, COPY data and the rest
 * of the command text are dropped here and never leave this function.
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
 * Fail-closed classification of a finished pg_restore process.
 * vaultEmpty: true when vault.secrets is verified empty in source and copy,
 * false when it holds rows, null when it could not be read.
 */
export function classifyRestore({ status, stderr, vaultEmpty }) {
  const failing = []
  const allowed = new Map()
  const count = (key) => allowed.set(key, (allowed.get(key) ?? 0) + 1)
  if (status === null || status === undefined)
    failing.push({ class: 'restore process reported no exit status' })
  const { entries, ignored } = parseRestoreStderr(stderr)
  if (
    status !== 0 &&
    status !== null &&
    status !== undefined &&
    entries.length === 0
  )
    failing.push({ class: 'restore failed without a classified error' })
  if (ignored !== null && ignored !== entries.length)
    failing.push({
      class: `restore ignored ${ignored} errors but ${entries.length} were classified`,
    })
  for (const entry of entries) {
    const c = entry.command
    if (
      entry.message === 'default_privileges' &&
      c.kind === 'default_acl' &&
      PLATFORM_DEFAULT_ACL[c.role]?.includes(c.schema)
    ) {
      count(`platform default privileges: role ${c.role}, schema ${c.schema}`)
      continue
    }
    if (
      entry.message === 'permission_denied_table' &&
      c.kind === 'copy' &&
      c.schema === 'vault' &&
      c.table === 'secrets'
    ) {
      if (vaultEmpty === true) {
        count(
          'vault.secrets data entry skipped; table verified empty in source and copy',
        )
        continue
      }
      failing.push({
        class:
          vaultEmpty === false
            ? 'vault.secrets holds rows that the restore could not copy'
            : 'vault.secrets could not be verified empty',
        object: 'vault.secrets',
      })
      continue
    }
    failing.push({
      class:
        entry.message === 'unknown'
          ? 'unclassified restore error'
          : entry.message,
      object:
        c.kind === 'default_acl'
          ? `default privileges for role ${c.role} in schema ${c.schema}`
          : c.kind === 'copy'
            ? `table data ${c.schema}.${c.table}`
            : c.kind,
    })
  }
  return {
    ok: failing.length === 0,
    allowed: [...allowed].map(([description, n]) => ({
      description,
      count: n,
    })),
    failing,
  }
}

const key = (row) => `${row.schema}.${row.table}`
const digits = (value) => {
  const text = String(value)
  if (!/^\d+$/.test(text)) throw new Error(`count is not an integer: ${text}`)
  return BigInt(text).toString()
}

/** Exact table sets in both directions and per-table counts compared as integers of any size. */
export function compareTableCounts(source, copy) {
  const target = new Map(copy.map((row) => [key(row), digits(row.n)]))
  const seen = new Set()
  const missing = []
  const mismatched = []
  for (const row of source) {
    const k = key(row)
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

/** Object inventory by stable identity and definition digest. */
export function compareInventory(source, copy) {
  const target = new Map(copy.map((o) => [`${o.kind}:${o.identity}`, o.digest]))
  const seen = new Set()
  const missing = []
  const changed = []
  const byKind = {}
  for (const o of source) {
    const k = `${o.kind}:${o.identity}`
    seen.add(k)
    byKind[o.kind] = (byKind[o.kind] ?? 0) + 1
    if (!target.has(k)) missing.push(k)
    else if (target.get(k) !== o.digest) changed.push(k)
  }
  const extra = [...target.keys()].filter((k) => !seen.has(k))
  return {
    ok: missing.length === 0 && extra.length === 0 && changed.length === 0,
    byKind,
    missing: missing.sort(),
    extra: extra.sort(),
    changed: changed.sort(),
  }
}

/**
 * Close the copy's session, drop only this run's copy, confirm it is gone.
 * Every step runs even when an earlier one failed; the first cleanup error
 * is returned, never thrown, so the caller can report it next to the primary
 * result. The admin session is the caller's to end.
 */
export async function cleanupCopy({ restored, admin, copy }) {
  const errors = []
  if (restored) {
    try {
      await restored.end()
    } catch (e) {
      errors.push(`closing the copy session failed: ${e?.code ?? 'error'}`)
    }
  }
  try {
    await admin.query(`drop database if exists "${copy}" with (force)`)
  } catch (e) {
    errors.push(`dropping ${copy} failed: ${e?.code ?? 'error'}`)
  }
  try {
    const left = await admin.query(
      'select 1 from pg_database where datname = $1',
      [copy],
    )
    if (left.rowCount > 0) errors.push(`${copy} still exists after cleanup`)
  } catch (e) {
    errors.push(`confirming cleanup failed: ${e?.code ?? 'error'}`)
  }
  return errors
}

/** Human-readable lines for the console; never includes anything but these results. */
export function verdictLines({ restore, tables, inventory, seconds }) {
  const lines = []
  for (const a of restore.allowed) lines.push(`${a.count} × ${a.description}`)
  for (const f of restore.failing)
    lines.push(`RESTORE ERROR: ${f.class}${f.object ? ` (${f.object})` : ''}`)
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
  const passed = restore.ok && tables.ok && inventory.ok
  lines.push(
    passed
      ? `APPLICATION RESTORE CHECK PASSED in ${seconds} s: public and komisio_private tables, row counts, functions, triggers, policies, constraints, indexes, RLS flags and grants match; every restore error is a known platform limitation`
      : `APPLICATION RESTORE CHECK FAILED in ${seconds} s`,
  )
  return { passed, lines }
}
