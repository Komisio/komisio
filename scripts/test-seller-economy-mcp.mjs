import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function testSellerEconomyMCP({ connect, rpc, db, uid }) {
  const tenant = await rpc('create_tenant', {
    p_name: 'Economy MCP fixture',
    p_slug: `economy-${randomUUID()}`,
    p_request_id: randomUUID(),
  })
  const seller = await rpc('register_seller', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_name: 'PRIVATE SELLER',
    p_email: 'private-economy@example.test',
    p_phone: '',
  })
  const client = await connect('economy:read', undefined, tenant)
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    ['komisio_read_seller_balance', 'komisio_read_seller_ledger'],
  )
  const balance = () =>
    client.callTool({
      name: 'komisio_read_seller_balance',
      arguments: { sellerId: seller },
    })
  const zero = await balance()
  assert(!zero.isError)
  assert.equal(zero.structuredContent.balance.availableOre, 0)
  for (let i = 0; i < 55; i++)
    await rpc('adjust_seller_ledger', {
      p_tenant: tenant,
      p_id: randomUUID(),
      p_seller: seller,
      p_amount_ore: i === 0 ? -100 : 100,
      p_reason: 'PRIVATE NOTE - do not send to a model',
    })
  const before = (
    await db.query(
      'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
      [tenant],
    )
  ).rows[0].n
  const total = await balance()
  assert(!total.isError)
  assert.equal(total.structuredContent.balance.availableOre, 5300)
  assert.equal(total.structuredContent.amountUnit, 'ore')
  assert.equal(total.structuredContent.currency, 'SEK')
  const ledger = await client.callTool({
    name: 'komisio_read_seller_ledger',
    arguments: { sellerId: seller },
  })
  assert(!ledger.isError)
  assert.equal(ledger.structuredContent.entries.length, 50)
  assert.equal(ledger.structuredContent.potentiallyTruncated, true)
  assert.equal(ledger.structuredContent.atomicSnapshot, false)
  assert(!JSON.stringify(ledger).includes('PRIVATE'))
  assert(!JSON.stringify(total).includes('private-economy'))
  assert.deepEqual(Object.keys(ledger.structuredContent.entries[0]).sort(), [
    'amountOre',
    'id',
    'kind',
    'occurredAt',
    'referenceId',
    'referenceKind',
  ])
  for (const args of [
    { sellerId: randomUUID() },
    { sellerId: seller, tenantId: tenant },
    { sellerId: seller, limit: 1000 },
  ]) {
    assert(
      (
        await client.callTool({
          name: 'komisio_read_seller_balance',
          arguments: args,
        })
      ).isError,
    )
  }
  const other = await connect('economy:read')
  assert(
    (
      await other.callTool({
        name: 'komisio_read_seller_balance',
        arguments: { sellerId: seller },
      })
    ).isError,
  )
  const unscoped = await connect('reception:read', undefined, tenant)
  assert(
    !(await unscoped.listTools()).tools.some(
      (t) =>
        t.name.includes('seller_balance') || t.name.includes('seller_ledger'),
    ),
  )
  const invalid = await connect('economy:read', 'invalid-token', tenant)
  assert(
    (
      await invalid.callTool({
        name: 'komisio_read_seller_balance',
        arguments: { sellerId: seller },
      })
    ).isError,
  )
  const secondOwner = randomUUID()
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [secondOwner, `economy-owner-${secondOwner}@example.test`],
  )
  await db.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
    [tenant, secondOwner],
  )
  await db.query(
    "update tenant_members set role='readonly' where tenant_id=$1 and user_id=$2",
    [tenant, uid],
  )
  try {
    assert(!(await balance()).isError)
  } finally {
    await db.query(
      "update tenant_members set role='owner' where tenant_id=$1 and user_id=$2",
      [tenant, uid],
    )
  }
  const after = (
    await db.query(
      'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
      [tenant],
    )
  ).rows[0].n
  assert.equal(after, before)
  console.log(
    'PASS: seller economy MCP scope, SQL balance, bounded minimized history, missing/foreign seller, invalid token, readonly access and no ledger writes.',
  )
}
