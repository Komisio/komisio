import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function raceSellerPayout({ setup, connectionString }) {
  const owner = randomUUID(),
    sellerUser = randomUUID(),
    email = `${sellerUser}@example.test`,
    id = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
    [owner, `${owner}@example.test`, sellerUser, email],
  )
  await setup.query('begin')
  await setup.query('set local role authenticated')
  await setup.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: owner, role: 'authenticated' }),
  ])
  const tenant = (
    await setup.query('select create_tenant($1,$2,$3) id', [
      'Payout race',
      `payout-${owner}`,
      randomUUID(),
    ])
  ).rows[0].id
  const seller = (
    await setup.query('select register_seller($1,$2,$3,$4,$5) id', [
      tenant,
      randomUUID(),
      'Synthetic seller',
      email,
      '',
    ])
  ).rows[0].id
  await setup.query('select adjust_seller_ledger($1,$2,$3,$4,$5)', [
    tenant,
    randomUUID(),
    seller,
    20000,
    'Synthetic balance',
  ])
  await setup.query('commit')
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: sellerUser, role: 'authenticated' }),
      ])
    }
    const results = await Promise.all(
      clients.map((c) =>
        c.query('select request_my_payout($1,$2,$3,$4) id', [
          tenant,
          id,
          seller,
          10000,
        ]),
      ),
    )
    assert.deepEqual(
      results.map((r) => r.rows[0].id),
      [id, id],
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from payouts where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from payout_events where payout_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select sum(amount_ore)::int n from seller_ledger_entries where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      20000,
    )
    console.log(
      'PASS: simultaneous seller request retries create one request/event and do not move money.',
    )
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
