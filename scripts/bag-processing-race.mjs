import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceBagProcessing({ setup, connectionString }) {
  const user = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [user, `${user}@example.test`],
  )
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ])
    }
    const [a, b] = clients
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Processing race',
        `processing-${user}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic seller','','123') id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid
    const receive = async () =>
      (
        await a.query(
          "select receive_bag_with_agreement($1,$2,$3,'Race',null) id",
          [tenant, randomUUID(), seller],
        )
      ).rows[0].id
    const blocked = async () => {
      for (let i = 0; i < 100; i++) {
        if (
          (
            await setup.query(
              'select wait_event_type from pg_stat_activity where pid=$1',
              [pid],
            )
          ).rows[0]?.wait_event_type === 'Lock'
        )
          return
        await pause(10)
      }
      throw new Error('Competing operation did not reach the tenant lock')
    }
    // Completion wins: a simultaneous preparation cannot open work behind it.
    let bag = await receive()
    const request = randomUUID()
    await a.query('begin')
    await a.query("select set_bag_processing($1,$2,$3,0,'completed','')", [
      tenant,
      request,
      bag,
    ])
    let other = b
      .query('select create_bag_reception($1,$2,$3,$4)', [
        tenant,
        randomUUID(),
        seller,
        bag,
      ])
      .then(
        () => null,
        (e) => e,
      )
    await blocked()
    await a.query('commit')
    assert.match((await other).message, /BAG_COMPLETED/)
    const replay = await b.query(
      "select set_bag_processing($1,$2,$3,0,'completed','') id",
      [tenant, request, bag],
    )
    assert.equal(replay.rows[0].id, request)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from bag_processing_events where bag_id=$1',
          [bag],
        )
      ).rows[0].n,
      1,
    )
    // Preparation wins: completion must observe the just-committed pending work.
    bag = await receive()
    await a.query('begin')
    await a.query('select create_bag_reception($1,$2,$3,$4)', [
      tenant,
      randomUUID(),
      seller,
      bag,
    ])
    other = b
      .query("select set_bag_processing($1,$2,$3,0,'completed','')", [
        tenant,
        randomUUID(),
        bag,
      ])
      .then(
        () => null,
        (e) => e,
      )
    await blocked()
    await a.query('commit')
    assert.match((await other).message, /BAG_PENDING_WORK/)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from bag_processing_events where bag_id=$1',
          [bag],
        )
      ).rows[0].n,
      0,
    )
    console.log(
      'PASS: drop-off completion and preparation serialize in both orders; completed bags never acquire pending work.',
    )
  } finally {
    for (const c of clients) {
      await c.query('rollback').catch(() => {})
      await c.end().catch(() => {})
    }
  }
}
