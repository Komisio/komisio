import { describe, expect, it, vi } from 'vitest'
import {
  classifyRestore,
  cleanupCopy,
  compareInventory,
  compareTableCounts,
  parseRestoreStderr,
  verdictLines,
} from '../../scripts/backup-verification.mjs'

// A synthetic marker stands in for anything that must never reach the
// output: error details, command text, COPY data, credentials.
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
const observed =
  [
    ['supabase_admin', 'extensions'],
    ['supabase_admin', 'graphql'],
    ['supabase_admin', 'graphql_public'],
    ['supabase_admin', 'public'],
    ['supabase_admin', 'supabase_functions'],
    ['supabase_auth_admin', 'auth'],
  ]
    .flatMap(([role, schema]) => [
      acl(role, schema),
      acl(role, schema),
      acl(role, schema),
    ])
    .join('') +
  vaultCopy +
  'pg_restore: warning: errors ignored on restore: 19\n'

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
  it('accepts the observed platform limitations when the vault is verified empty', () => {
    const r = classifyRestore({ status: 1, stderr: observed, vaultEmpty: true })
    expect(r.ok).toBe(true)
    expect(r.failing).toEqual([])
    expect(r.allowed).toHaveLength(7)
    expect(r.allowed.map((a) => a.count)).toEqual([3, 3, 3, 3, 3, 3, 1])
    expect(JSON.stringify(r)).not.toContain(MARKER)
  })
  it('passes a clean exit with no output', () => {
    expect(
      classifyRestore({ status: 0, stderr: '', vaultEmpty: null }).ok,
    ).toBe(true)
  })
  it.each([
    [{ status: null, stderr: observed, vaultEmpty: true }, 'no exit status'],
    [{ status: undefined, stderr: '', vaultEmpty: true }, 'no exit status'],
    [{ status: 1, stderr: '', vaultEmpty: true }, 'without a classified error'],
    [
      {
        status: 2,
        stderr: 'garbage that is not pg_restore output\n',
        vaultEmpty: true,
      },
      'without a classified error',
    ],
  ])('fails closed on an unknown failed process %j', (input, text) => {
    const r = classifyRestore(input as never)
    expect(r.ok).toBe(false)
    expect(r.failing.map((f) => f.class).join(' ')).toContain(text)
  })
  it('fails when the ignored count disagrees with what was parsed', () => {
    const r = classifyRestore({
      status: 1,
      stderr:
        acl('supabase_auth_admin', 'auth') +
        'pg_restore: warning: errors ignored on restore: 2\n',
      vaultEmpty: true,
    })
    expect(r.ok).toBe(false)
    expect(r.failing[0].class).toContain('ignored 2 errors but 1')
  })
  it.each([
    ['supabase_admin', 'komisio_private'],
    ['postgres', 'public'],
    ['supabase_storage_admin', 'auth'],
    ['supabase_auth_admin', 'storage'],
  ])(
    'refuses a default-privilege entry outside the observed pairs (%s, %s)',
    (role, schema) => {
      const r = classifyRestore({
        status: 1,
        stderr: acl(role, schema),
        vaultEmpty: true,
      })
      expect(r.ok).toBe(false)
      expect(r.failing).toEqual([
        {
          class: 'default_privileges',
          object: `default privileges for role ${role} in schema ${schema}`,
        },
      ])
    },
  )
  it('refuses application data, functions and unclassified errors', () => {
    const stderr = [
      'pg_restore: error: could not execute query: ERROR:  permission denied for table items',
      `Command was: COPY public.items (id, secret) FROM stdin;`,
      `DETAIL:  ${MARKER}`,
      'pg_restore: error: could not execute query: ERROR:  syntax error at or near "x"',
      `Command was: CREATE FUNCTION public.f() ${MARKER}`,
      'pg_restore: error: could not execute query: ERROR:  permission denied to change default privileges',
      'Command was: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA komisio_private GRANT ALL ON TABLES TO anon;',
      '',
    ].join('\n')
    const r = classifyRestore({ status: 1, stderr, vaultEmpty: true })
    expect(r.ok).toBe(false)
    expect(r.failing).toEqual([
      { class: 'permission_denied_table', object: 'table data public.items' },
      { class: 'unclassified restore error', object: 'other' },
      {
        class: 'default_privileges',
        object:
          'default privileges for role supabase_admin in schema komisio_private',
      },
    ])
    expect(JSON.stringify(r)).not.toContain(MARKER)
  })
  it.each([
    [false, 'holds rows'],
    [null, 'could not be verified empty'],
  ])(
    'refuses the vault data entry when the table is not verified empty (%s)',
    (vaultEmpty, text) => {
      const r = classifyRestore({ status: 1, stderr: vaultCopy, vaultEmpty })
      expect(r.ok).toBe(false)
      expect(r.failing).toEqual([
        { class: expect.stringContaining(text), object: 'vault.secrets' },
      ])
    },
  )
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
  it('refuses a count that is not an integer', () => {
    expect(() =>
      compareTableCounts(
        rows([['public', 'a', '1.5']]),
        rows([['public', 'a', '1.5']]),
      ),
    ).toThrow('not an integer')
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
      o('rls', 'public.items', 'true|false'),
    ]
    const copy = [
      o('rls', 'public.items', 'true|false'),
      o('function', 'public.f(uuid)', 'zzz'),
      o('trigger', 'public.items.extra', 'ccc'),
    ]
    const r = compareInventory(source, copy)
    expect(r).toEqual({
      ok: false,
      byKind: { function: 1, policy: 1, rls: 1 },
      missing: ['policy:public.items.read'],
      extra: ['trigger:public.items.extra'],
      changed: ['function:public.f(uuid)'],
    })
    expect(compareInventory(source, [...source].reverse()).ok).toBe(true)
  })
})

describe('cleanupCopy', () => {
  const copy = 'komisio_restore_0123456789abcdef0123456789abcdef'
  it('ends the copy session before dropping only that copy and confirms it is gone', async () => {
    const order: string[] = []
    const restored = { end: vi.fn(async () => void order.push('end')) }
    const admin = {
      query: vi.fn(async (sql: string) => {
        order.push(sql.split(' ').slice(0, 2).join(' '))
        return { rowCount: 0, rows: [] }
      }),
    }
    expect(await cleanupCopy({ restored, admin, copy })).toEqual([])
    expect(order).toEqual(['end', 'drop database', 'select 1'])
    expect(admin.query.mock.calls[0][0]).toBe(
      `drop database if exists "${copy}" with (force)`,
    )
    expect(admin.query.mock.calls[1][1]).toEqual([copy])
  })
  it('still drops when closing the session fails and reports both errors without throwing', async () => {
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
    const errors = await cleanupCopy({ restored, admin, copy })
    expect(errors).toEqual([
      'closing the copy session failed: ECONNRESET',
      `dropping ${copy} failed: 55006`,
      `${copy} still exists after cleanup`,
    ])
    expect(JSON.stringify(errors)).not.toContain(MARKER)
  })
  it('works when the copy session was never opened', async () => {
    const admin = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }
    expect(await cleanupCopy({ restored: null, admin, copy })).toEqual([])
  })
})

describe('verdictLines', () => {
  it('names the check precisely and fails when any part fails', () => {
    const restore = classifyRestore({
      status: 1,
      stderr: observed,
      vaultEmpty: true,
    })
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
