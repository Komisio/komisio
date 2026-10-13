import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceSellerActivation({ setup, connectionString }) {
  const actor = randomUUID(),
    requestId = randomUUID(),
    seller = randomUUID(),
    message = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `activation-${actor}@example.test`],
  )
  const clients = []
  try {
    for (let i = 0; i < 2; i++) {
      const c = new pg.Client({
        connectionString,
        application_name: `activation_race_${i}`,
      })
      await c.connect()
      clients.push(c)
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const tenant = (
      await clients[0].query('select create_tenant($1,$2,$3) id', [
        'Activation race',
        `activation-${requestId}`,
        requestId,
      ])
    ).rows[0].id
    await clients[0].query('select register_seller($1,$2,$3,$4,$5)', [
      tenant,
      seller,
      'Synthetic seller',
      'activation-race@example.test',
      '',
    ])
    await clients[0].query(
      "select queue_seller_communication($1,$2,$3,'message','seller.welcome','v2','en','Activate','Notice','none',null)",
      [tenant, message, seller],
    )
    await setup.query('begin')
    await setup.query('select id from tenants where id=$1 for update', [tenant])
    const attempts = clients.map((c) =>
      c.query('select claim_seller_activation($1,$2,$3) claimed', [
        tenant,
        message,
        'activation-race@example.test',
      ]),
    )
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'activation_race_%' and wait_event_type='Lock'",
        )
      ).rows[0].n
      if (waiting === 2) break
      await pause(20)
    }
    await setup.query('commit')
    const results = await Promise.all(attempts)
    assert.equal(waiting, 2)
    assert.deepEqual(results.map((r) => r.rows[0].claimed).sort(), [
      false,
      true,
    ])
    console.log(
      'PASS: concurrent seller activation requests permit exactly one Auth send.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.all(clients.map((c) => c.end()))
  }
}
