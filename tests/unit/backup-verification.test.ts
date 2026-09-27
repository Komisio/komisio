import { describe, expect, it, vi } from 'vitest'
import {
  classifyRestore,
  cleanupCopy,
  compareInventory,
  compareTableCounts,
  grantInventory,
  parseRestoreStderr,
  runRestoreExercise,
  verdictLines,
} from '../../scripts/backup-verification.mjs'

// A synthetic marker stands in for anything that must never reach the
// output: error details, command text, COPY data, credentials, messages.
const MARKER = 'SYNTHETIC-PAYLOAD-MARKER'
const acl = (role: string, schema: string) =>
  [
    `pg_restore: error: could not execute query: ERROR:  permission denied to change default privileges`,
    `Command was: ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA ${schema} GRANT ALL ON TABLES TO ${MARKER};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA ${schema} GRANT ALL ON TABLES TO ${MARKER};`,
    '',
  ].join('\n')
const vaultCopy = [
  'pg_restore: error: could not execute query: ERROR:  permission denied for table secrets',
  `Command was: COPY vault.secrets (id, name, description, secret) FROM stdin;`,
  `DETAIL:  ${MARKER}`,
  '',
].join('\n')
const ignoredLine = (n: number) =>
  `pg_restore: warning: errors ignored on restore: ${n}\n`
// The stderr observed on the local stack on 2026-09-28 when restoring as
// postgres without ownership: 18 default-privilege entries, 1 vault entry.
const observed =
  (
    [
      ['supabase_admin', 'extensions'],
      ['supabase_admin', 'graphql'],
      ['supabase_admin', 'graphql_public'],
      ['supabase_admin', 'public'],
      ['supabase_admin', 'supabase_functions'],
      ['supabase_auth_admin', 'auth'],
    ] as [string, string][]
  )
    .flatMap(([role, schema]) => [
      acl(role, schema),
      acl(role, schema),
      acl(role, schema),
    ])
    .join('') +
  vaultCopy +
  ignoredLine(19)

describe('parseRestoreStderr', () => {
  it('keeps only the error class and object identifiers', () => {
    const { entries, ignored } = parseRestoreStderr(observed)
    expect(entries).toHaveLength(19)
    expect(ignored).toBe(19)
    expect(entries[0]).toEqual({
      message: 'default_privileges',
      command: {
        kind: 'default_acl',
        role: 'supabase_admin',
        schema: 'extensions',
      },
    })
    expect(entries[18]).toEqual({
      message: 'permission_denied_table',
      command: { kind: 'copy', schema: 'vault', table: 'secrets' },
    })
    expect(JSON.stringify(entries)).not.toContain(MARKER)
  })
  it('marks an error without a parsable command as unparsed', () => {
    const { entries } = parseRestoreStderr(
      `pg_restore: error: could not execute query: ERROR:  something odd ${MARKER}\nCommand was: CREATE WIDGET ${MARKER};\n`,
    )
    expect(entries).toEqual([
      { message: 'unknown', command: { kind: 'other' } },
    ])
    expect(
      parseRestoreStderr(`pg_restore: error: could not read ${MARKER}\n`)
        .entries,
    ).toEqual([{ message: 'unknown', command: { kind: 'unparsed' } }])
  })
})

describe('classifyRestore', () => {
  it('passes only a normal exit 0 with no error and no ignored-error line', () => {
    expect(classifyRestore({ status: 0, stderr: '' })).toEqual({
      ok: true,
      failing: [],
    })
    expect(
      classifyRestore({ status: 0, stderr: 'pg_restore: processing data\n' })
        .ok,
    ).toBe(true)
  })
  it('summarises the previously observed run as failures, no exceptions', () => {
    const r = classifyRestore({ status: 1, stderr: observed })
    expect(r.ok).toBe(false)
    expect(r.failing[0]).toEqual({ class: 'restore exited with status 1' })
    expect(r.failing[1]).toEqual({
      class: 'restore reported 19 ignored errors',
    })
    expect(r.failing).toContainEqual({
      class:
        'default_privileges (default privileges for role supabase_admin in schema public)',
      count: 3,
    })
    expect(r.failing).toContainEqual({
      class: 'permission_denied_table (table data vault.secrets)',
      count: 1,
    })
    expect(r.failing).toHaveLength(2 + 6 + 1)
    expect(JSON.stringify(r)).not.toContain(MARKER)
  })
  it.each([
    [{ status: null, stderr: '' }, 'no exit status'],
    [{ status: undefined, stderr: '' }, 'no exit status'],
    [{ status: 1, stderr: '' }, 'exited with status 1'],
    [{ status: 2, stderr: 'garbage\n' }, 'exited with status 2'],
    [{ status: 0, stderr: ignoredLine(0) }, 'reported 0 ignored errors'],
    [
      { status: 0, stderr: acl('supabase_auth_admin', 'auth') },
      'default_privileges (default privileges for role supabase_auth_admin in schema auth)',
    ],
    [
      { status: 0, stderr: `pg_restore: error: boom ${MARKER}\n` },
      'unclassified restore error (unparsed)',
    ],
  ])('fails closed on %j', (input, text) => {
    const r = classifyRestore(input as never)
    expect(r.ok).toBe(false)
    expect(r.failing.map((f) => f.class).join(' ')).toContain(text)
    expect(JSON.stringify(r)).not.toContain(MARKER)
  })
  it('summarises application data and function failures with their objects', () => {
    const stderr =
      [
        'pg_restore: error: could not execute query: ERROR:  permission denied for table items',
        `Command was: COPY public.items (id, secret) FROM stdin;`,
        `DETAIL:  ${MARKER}`,
        'pg_restore: error: could not execute query: ERROR:  syntax error at or near "x"',
        `Command was: CREATE FUNCTION public.f() ${MARKER}`,
        '',
      ].join('\n') + ignoredLine(2)
    const r = classifyRestore({ status: 1, stderr })
    expect(r.failing).toEqual([
      { class: 'restore exited with status 1' },
      { class: 'restore reported 2 ignored errors' },
      { class: 'permission_denied_table (table data public.items)', count: 1 },
      { class: 'unclassified restore error (other)', count: 1 },
    ])
    expect(JSON.stringify(r)).not.toContain(MARKER)
  })
})

describe('compareTableCounts', () => {
  const rows = (list: [string, string, string][]) =>
    list.map(([schema, table, n]) => ({ schema, table, n }))
  it('matches by schema and table name, never by position, with big integers exact', () => {
    const source = rows([
      ['public', 'items', '9007199254740993'],
      ['komisio_private', 'shopify_sync_settings', '3'],
      ['public', 'sellers', '12'],
    ])
    const copy = rows([
      ['public', 'sellers', '12'],
      ['public', 'items', '9007199254740993'],
      ['komisio_private', 'shopify_sync_settings', '3'],
    ])
    expect(compareTableCounts(source, copy)).toEqual({
      ok: true,
      tables: 3,
      missing: [],
      extra: [],
      mismatched: [],
    })
    const off = rows([
      ['public', 'sellers', '12'],
      ['public', 'items', '9007199254740992'],
      ['komisio_private', 'shopify_sync_settings', '3'],
    ])
    expect(compareTableCounts(source, off).mismatched).toEqual([
      {
        table: 'public.items',
        source: '9007199254740993',
        copy: '9007199254740992',
      },
    ])
  })
  it('reports missing and extra tables by name', () => {
    const source = rows([
      ['public', 'a', '1'],
      ['public', 'b', '2'],
      ['public', 'c', '3'],
    ])
    const copy = rows([
      ['public', 'a', '1'],
      ['public', 'c', '3'],
      ['public', 'zz_extra', '0'],
    ])
    const r = compareTableCounts(source, copy)
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['public.b'])
    expect(r.extra).toEqual(['public.zz_extra'])
    expect(r.mismatched).toEqual([])
  })
  it('refuses a count that is not an integer without echoing it', () => {
    expect(() =>
      compareTableCounts(
        rows([['public', 'a', MARKER]]),
        rows([['public', 'a', MARKER]]),
      ),
    ).toThrow(/^count is not an integer$/)
  })
})

describe('grantInventory', () => {
  const grant = (
    kind: string,
    object: string,
    grantee: string | null,
    privilege: string,
    grantable = false,
    grantor = 'postgres',
  ) => ({
    kind,
    schema: 'public',
    object,
    grantee,
    privilege,
    grantable,
    grantor,
  })
  it('folds privileges into one digest per object with PUBLIC, grant option and grantor', () => {
    const rows = [
      grant('routine_grants', 'f(uuid)', 'authenticated', 'EXECUTE'),
      grant('routine_grants', 'f(uuid)', null, 'EXECUTE'),
      grant('table_grants', 'items', 'anon', 'SELECT', true, 'supabase_admin'),
    ]
    expect(grantInventory(rows)).toEqual([
      {
        kind: 'routine_grants',
        identity: 'public.f(uuid)',
        digest: 'PUBLIC:EXECUTE:-:postgres,authenticated:EXECUTE:-:postgres',
      },
      {
        kind: 'table_grants',
        identity: 'public.items',
        digest: 'anon:SELECT:g:supabase_admin',
      },
    ])
  })
  it('gives the same identity to the same routine regardless of database OIDs, and fails on PUBLIC, grant-option or grantor differences', () => {
    // The identity is built from schema, name and argument types only, so a
    // routine restored with a different OID compares equal.
    const source = grantInventory([
      grant('routine_grants', 'f(uuid)', 'authenticated', 'EXECUTE'),
      grant('routine_grants', 'f(uuid)', null, 'EXECUTE'),
    ])
    const same = grantInventory([
      grant('routine_grants', 'f(uuid)', null, 'EXECUTE'),
      grant('routine_grants', 'f(uuid)', 'authenticated', 'EXECUTE'),
    ])
    expect(compareInventory(source, same).ok).toBe(true)
    const noPublic = grantInventory([
      grant('routine_grants', 'f(uuid)', 'authenticated', 'EXECUTE'),
    ])
    expect(compareInventory(source, noPublic).changed).toEqual([
      'routine_grants:public.f(uuid)',
    ])
    const withOption = grantInventory([
      grant('routine_grants', 'f(uuid)', 'authenticated', 'EXECUTE', true),
      grant('routine_grants', 'f(uuid)', null, 'EXECUTE'),
    ])
    expect(compareInventory(source, withOption).changed).toEqual([
      'routine_grants:public.f(uuid)',
    ])
    const otherGrantor = grantInventory([
      grant(
        'routine_grants',
        'f(uuid)',
        'authenticated',
        'EXECUTE',
        false,
        'supabase_admin',
      ),
      grant('routine_grants', 'f(uuid)', null, 'EXECUTE'),
    ])
    expect(compareInventory(source, otherGrantor).changed).toEqual([
      'routine_grants:public.f(uuid)',
    ])
  })
})

describe('compareInventory', () => {
  const o = (kind: string, identity: string, digest: string) => ({
    kind,
    identity,
    digest,
  })
  it('detects a changed function body and missing or extra objects by identity', () => {
    const source = [
      o('function', 'public.f(uuid)', 'aaa'),
      o('policy', 'public.items.read', 'bbb'),
      o('table', 'public.items', 'true|false|postgres'),
    ]
    const copy = [
      o('table', 'public.items', 'true|false|postgres'),
      o('function', 'public.f(uuid)', 'zzz'),
      o('trigger', 'public.items.extra', 'ccc'),
    ]
    expect(compareInventory(source, copy)).toEqual({
      ok: false,
      byKind: { function: 1, policy: 1, table: 1 },
      missing: ['policy:public.items.read'],
      extra: ['trigger:public.items.extra'],
      changed: ['function:public.f(uuid)'],
    })
    expect(compareInventory(source, [...source].reverse()).ok).toBe(true)
  })
})

const copyName = 'komisio_restore_0123456789abcdef0123456789abcdef'

describe('cleanupCopy', () => {
  it('ends the copy session before dropping only that copy and confirms it is gone', async () => {
    const order: string[] = []
    const restored = { end: vi.fn(async () => void order.push('end')) }
    const admin = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        order.push(sql.split(' ').slice(0, 2).join(' '))
        void params
        return { rowCount: 0, rows: [] }
      }),
    }
    expect(
      await cleanupCopy({ restored, admin, copy: copyName, created: true }),
    ).toEqual([])
    expect(order).toEqual(['end', 'drop database', 'select 1'])
    expect(admin.query.mock.calls[0][0]).toBe(
      `drop database if exists "${copyName}" with (force)`,
    )
    expect(admin.query.mock.calls[1][1]).toEqual([copyName])
  })
  it('never drops when this run did not create the copy', async () => {
    const admin = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }
    const restored = { end: vi.fn(async () => {}) }
    expect(
      await cleanupCopy({ restored, admin, copy: copyName, created: false }),
    ).toEqual([])
    expect(admin.query).not.toHaveBeenCalled()
    expect(restored.end).toHaveBeenCalled()
  })
  it.each([
    'postgres',
    'komisio_restore_x',
    'komisio_restore_0123456789abcdef0123456789abcde"; drop database postgres; --',
  ])(
    'never drops a name that is not the generated shape (%s)',
    async (copy) => {
      const admin = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }
      const errors = await cleanupCopy({
        restored: null,
        admin,
        copy,
        created: true,
      })
      expect(errors).toEqual([
        'copy name is not the generated shape; nothing dropped',
      ])
      expect(admin.query).not.toHaveBeenCalled()
    },
  )
  it('still drops when closing the session fails and reports fixed phrases without throwing', async () => {
    const restored = {
      end: vi.fn(async () => {
        throw Object.assign(new Error(MARKER), { code: 'ECONNRESET' })
      }),
    }
    const admin = {
      query: vi.fn(async (sql: string) =>
        sql.startsWith('drop')
          ? Promise.reject(Object.assign(new Error(MARKER), { code: '55006' }))
          : { rowCount: 1, rows: [{}] },
      ),
    }
    const errors = await cleanupCopy({
      restored,
      admin,
      copy: copyName,
      created: true,
    })
    expect(errors).toEqual([
      'closing the copy session failed (ECONNRESET)',
      'dropping the copy failed (55006)',
      'the copy still exists after cleanup',
    ])
    expect(JSON.stringify(errors)).not.toContain(MARKER)
  })
})

describe('runRestoreExercise', () => {
  type Rows = Record<string, unknown>[]
  const counts: Rows = [
    { schema: 'public', table: 'items', n: '3' },
    { schema: 'komisio_private', table: 'shopify_sync_settings', n: '1' },
  ]
  const inventory: Rows = [
    { kind: 'function', identity: 'public.f(uuid)', digest: 'a' },
    { kind: 'table', identity: 'public.items', digest: 'true|false|postgres' },
  ]
  const grants: Rows = [
    {
      kind: 'table_grants',
      schema: 'public',
      object: 'items',
      grantee: 'authenticated',
      privilege: 'SELECT',
      grantable: false,
      grantor: 'postgres',
    },
  ]
  function harness(
    options: {
      restore?: { status: number | null; stderr: string }
      fail?: { phase: string; error: unknown }
    } = {},
  ) {
    const log: string[] = []
    const calls: string[] = []
    const spawned: string[][] = []
    const dbs: Record<string, ReturnType<typeof makeClient>> = {}
    const makeClient = (database: string) => {
      const client = {
        database,
        ended: false,
        connect: vi.fn(async () => {
          if (options.fail?.phase === 'connect' && database === 'postgres')
            throw options.fail.error
          if (options.fail?.phase === 'connect copy' && database !== 'postgres')
            throw options.fail.error
        }),
        query: vi.fn(async (sql: string) => {
          calls.push(`${database}:${sql.split(' ').slice(0, 3).join(' ')}`)
          if (sql.startsWith('create database')) {
            if (options.fail?.phase === 'create copy') throw options.fail.error
            return { rowCount: 0, rows: [] }
          }
          if (sql.startsWith('drop database')) return { rowCount: 0, rows: [] }
          if (sql.startsWith('select 1 from pg_database'))
            return { rowCount: 0, rows: [] }
          if (sql.includes('query_to_xml')) {
            if (options.fail?.phase === 'counts') throw options.fail.error
            return { rows: counts }
          }
          if (sql.includes("'function' as kind")) return { rows: inventory }
          if (sql.includes('aclexplode')) return { rows: grants }
          throw new Error('unexpected sql')
        }),
        end: vi.fn(async () => {
          client.ended = true
        }),
      }
      dbs[database] = client
      return client
    }
    const spawn = vi.fn((args: string[]) => {
      spawned.push(args)
      calls.push(`spawn:${args[0]}`)
      if (args[0] === 'pg_dump')
        return options.fail?.phase === 'dump'
          ? { status: 1, stderr: MARKER }
          : { status: 0, stderr: '' }
      if (args[0] === 'pg_restore')
        return options.restore ?? { status: 0, stderr: '' }
      return { status: 0, stderr: '' }
    })
    return {
      log,
      calls,
      spawned,
      dbs,
      run: (copy = copyName, restoreUser = 'supabase_admin') =>
        runRestoreExercise({
          spawn,
          newClient: makeClient,
          log: (line: string) => log.push(line),
          copy,
          dump: `/tmp/${copy}.dump`,
          restoreUser,
          now: () => 0,
        }),
    }
  }
  it('passes a clean run, restores as the configured role with ownership kept, prints only verdict lines and cleans up', async () => {
    const h = harness()
    expect(await h.run()).toBe(0)
    expect(h.log.at(-1)).toMatch(/^APPLICATION RESTORE CHECK PASSED in 0 s/)
    expect(h.log.join('\n')).not.toContain('RESTORE OK')
    expect(h.log.join('\n')).not.toContain(MARKER)
    const restore = h.spawned.find((a) => a[0] === 'pg_restore')!
    expect(restore).toEqual([
      'pg_restore',
      '-U',
      'supabase_admin',
      '-d',
      copyName,
      '-N',
      'realtime',
      '-N',
      '_realtime',
      `/tmp/${copyName}.dump`,
    ])
    expect(restore).not.toContain('--no-owner')
    expect(h.calls).toContain('postgres:drop database if')
    expect(h.calls.indexOf('postgres:drop database if')).toBeGreaterThan(
      h.calls.lastIndexOf(`${copyName}:select 'function' as`),
    )
    expect(h.dbs[copyName].ended).toBe(true)
    expect(h.dbs.postgres.ended).toBe(true)
    expect(h.spawned.some((a) => a[0] === 'rm')).toBe(true)
  })
  it('fails and never prints a thrown message when a query fails mid-run', async () => {
    const h = harness({
      fail: {
        phase: 'counts',
        error: Object.assign(new Error(MARKER), { code: '42501' }),
      },
    })
    expect(await h.run()).toBe(1)
    expect(h.log).toEqual([
      'APPLICATION RESTORE CHECK FAILED: error during counts (42501)',
    ])
    expect(h.calls).toContain('postgres:drop database if')
    expect(h.dbs[copyName].ended).toBe(true)
    expect(h.dbs.postgres.ended).toBe(true)
  })
  it('does not drop anything when creating the copy failed, and still ends the admin session', async () => {
    const h = harness({
      fail: { phase: 'create copy', error: new Error(MARKER) },
    })
    expect(await h.run()).toBe(1)
    expect(h.log).toEqual([
      'APPLICATION RESTORE CHECK FAILED: error during create copy',
    ])
    expect(h.calls.filter((c) => c.includes('drop database'))).toEqual([])
    expect(h.dbs.postgres.ended).toBe(true)
  })
  it('does not dump, drop or restore when the admin connection fails', async () => {
    const h = harness({
      fail: {
        phase: 'connect',
        error: Object.assign(new Error(MARKER), { code: 'ECONNREFUSED' }),
      },
    })
    expect(await h.run()).toBe(1)
    expect(h.log).toEqual([
      'APPLICATION RESTORE CHECK FAILED: error during connect (ECONNREFUSED)',
    ])
    expect(h.calls).toEqual([])
    expect(h.spawned).toEqual([])
    expect(h.dbs.postgres.ended).toBe(true)
  })
  it.each([
    ['postgres', 'supabase_admin'],
    [copyName, 'supabase_admin; drop database postgres'],
    [copyName, 'Supabase_Admin'],
    [copyName, ''],
  ])(
    'refuses to run with an unsafe copy name or role (%s, %s)',
    async (copy, role) => {
      const h = harness()
      expect(await h.run(copy, role)).toBe(1)
      expect(h.log).toEqual([
        'APPLICATION RESTORE CHECK FAILED: error during configuration',
      ])
      expect(h.calls).toEqual([])
      expect(h.spawned).toEqual([])
    },
  )
  it('fails the verdict on any restore error and summarises it', async () => {
    const h = harness({ restore: { status: 1, stderr: observed } })
    expect(await h.run()).toBe(1)
    expect(h.log[0]).toBe('RESTORE ERROR: restore exited with status 1')
    expect(h.log.join('\n')).toContain(
      'RESTORE ERROR: 3 × default_privileges (default privileges for role supabase_admin in schema public)',
    )
    expect(h.log.at(-1)).toBe('APPLICATION RESTORE CHECK FAILED in 0 s')
    expect(h.log.join('\n')).not.toContain(MARKER)
    expect(h.calls).toContain('postgres:drop database if')
  })
  it('fails on a dump failure without printing its output', async () => {
    const h = harness({ fail: { phase: 'dump', error: null } })
    expect(await h.run()).toBe(1)
    expect(h.log).toEqual([
      'APPLICATION RESTORE CHECK FAILED: error during dump',
    ])
    expect(h.log.join('\n')).not.toContain(MARKER)
    expect(h.calls.filter((c) => c.includes('drop database'))).toEqual([])
    expect(h.spawned.some((a) => a[0] === 'rm')).toBe(true)
  })
})

describe('verdictLines', () => {
  it('names the check precisely and fails when any part fails', () => {
    const restore = classifyRestore({ status: 0, stderr: '' })
    const tables = compareTableCounts(
      [{ schema: 'public', table: 'items', n: '1' }],
      [{ schema: 'public', table: 'items', n: '1' }],
    )
    const inventory = compareInventory(
      [{ kind: 'function', identity: 'public.f()', digest: 'a' }],
      [{ kind: 'function', identity: 'public.f()', digest: 'a' }],
    )
    const good = verdictLines({ restore, tables, inventory, seconds: 7 })
    expect(good.passed).toBe(true)
    expect(good.lines.at(-1)).toMatch(
      /^APPLICATION RESTORE CHECK PASSED in 7 s/,
    )
    expect(good.lines.at(-1)).not.toMatch(
      /complete|content|storage|point-in-time/,
    )
    expect(good.lines.join('\n')).not.toContain('RESTORE OK')
    expect(good.lines.join('\n')).not.toContain(MARKER)
    const bad = verdictLines({
      restore,
      tables,
      inventory: compareInventory(
        [{ kind: 'function', identity: 'public.f()', digest: 'a' }],
        [{ kind: 'function', identity: 'public.f()', digest: 'b' }],
      ),
      seconds: 7,
    })
    expect(bad.passed).toBe(false)
    expect(bad.lines).toContain('OBJECT DIFFERENCE function:public.f()')
    expect(bad.lines.at(-1)).toBe('APPLICATION RESTORE CHECK FAILED in 7 s')
  })
})
