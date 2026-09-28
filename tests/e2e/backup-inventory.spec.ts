import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import {
  INVENTORY_SQL,
  GRANTS_SQL,
  compareInventory,
  grantInventory,
} from '../../scripts/backup-verification.mjs'

test('restore inventory executes on PostgreSQL and detects executable and ACL differences', async () => {
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  })
  const name = `restore_probe_${randomUUID().replaceAll('-', '')}`
  await db.connect()
  try {
    await db.query('begin')
    // Isolated transactional metadata only: no application rows or roles changed.
    await db.query(
      `create function public.${name}(n integer default 1) returns integer language sql immutable as 'select n'`,
    )
    await db.query(
      `create table public.${name}(reason text constraint ${name}_check check (((length(reason)>=1 and length(reason)<=500) and reason=btrim(reason))))`,
    )
    await db.query(`create sequence public.${name}_seq`)
    const inventory = async () => (await db.query(INVENTORY_SQL)).rows
    const grants = async () => grantInventory((await db.query(GRANTS_SQL)).rows)
    const before = await inventory()
    await db.query(
      `create or replace function public.${name}(n integer default 2) returns integer language sql immutable strict as 'select n'`,
    )
    expect(compareInventory(before, await inventory()).changed).toEqual([
      `function:public.${name}(n integer)`,
    ])
    const nested = await inventory()
    await db.query(`alter table public.${name} drop constraint ${name}_check`)
    await db.query(
      `alter table public.${name} add constraint ${name}_check check (length(reason)>=1 and length(reason)<=500 and reason=btrim(reason))`,
    )
    expect(compareInventory(nested, await inventory()).ok).toBe(true)
    await db.query(`alter table public.${name} drop constraint ${name}_check`)
    await db.query(
      `alter table public.${name} add constraint ${name}_check check (length(reason)>=2 and length(reason)<=500 and reason=btrim(reason))`,
    )
    expect(compareInventory(nested, await inventory()).changed).toEqual([
      `constraint:public.${name}.${name}_check`,
    ])
    await db.query(
      `revoke all on sequence public.${name}_seq from authenticated`,
    )
    const defaultAcl = await grants()
    await db.query(`grant all on sequence public.${name}_seq to postgres`)
    expect(compareInventory(defaultAcl, await grants()).ok).toBe(true)
    await db.query(
      `grant usage on sequence public.${name}_seq to authenticated`,
    )
    expect(compareInventory(defaultAcl, await grants()).changed).toEqual([
      `table_grants:public.${name}_seq`,
    ])
    const publicGrant = await grants()
    await db.query(
      `revoke execute on function public.${name}(integer) from public`,
    )
    expect(compareInventory(publicGrant, await grants()).changed).toEqual([
      `routine_grants:public.${name}(n integer)`,
    ])
  } finally {
    await db.query('rollback')
    await db.end()
  }
})
