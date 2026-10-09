import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceStocktake({ setup, connectionString }) {
  const user = randomUUID(),
    clients = [
      new pg.Client({ connectionString }),
      new pg.Client({ connectionString }),
    ]
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [user, `${user}@example.test`],
  )
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ])
    }
    const [a, b] = clients,
      tenant = (
        await a.query('select create_tenant($1,$2,$3) id', [
          'Stocktake race',
          `stocktake-${user}`,
          randomUUID(),
        ])
      ).rows[0].id
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\'::jsonb)',
      [tenant, randomUUID()],
    )
    const purchase = randomUUID(),
      item = randomUUID()
    await a.query(
      "select register_purchase($1,$2,'Synthetic lamp',10000,'Race receipt',false)",
      [tenant, purchase],
    )
    await a.query("select accept_item($1,$2,'purchase',$3,null,20000)", [
      tenant,
      item,
      purchase,
    ])
    const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid
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
      throw Error('Stocktake competitor did not reach lock')
    }
    let session = randomUUID()
    await a.query('begin')
    await a.query('select start_stocktake($1,$2)', [tenant, session])
    let other = b
      .query('select start_stocktake($1,$2)', [tenant, randomUUID()])
      .then(
        () => null,
        (e) => e,
      )
    await blocked()
    await a.query('commit')
    assert.match((await other).message, /STOCKTAKE_OPEN/)
    const scan = (c, id = randomUUID()) =>
      c.query("select record_stocktake($1,$2,$3,'scan',$4,null,null,null,'')", [
        tenant,
        id,
        session,
        item,
      ])
    const close = (c, version) =>
      c.query("select record_stocktake($1,$2,$3,'closed','',null,$4,null,'')", [
        tenant,
        randomUUID(),
        session,
        version,
      ])
    await a.query('begin')
    await scan(a)
    other = close(b, 0).then(
      () => null,
      (e) => e,
    )
    await blocked()
    await a.query('commit')
    assert.match((await other).message, /STOCKTAKE_CHANGED/)
    await a.query('begin')
    await close(a, 1)
    other = scan(b).then(
      () => null,
      (e) => e,
    )
    await blocked()
    await a.query('commit')
    assert.match((await other).message, /STOCKTAKE_CLOSED/)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from stocktake_events where session_id=$1',
          [session],
        )
      ).rows[0].n,
      2,
    )
    session = randomUUID()
    await a.query('select start_stocktake($1,$2)', [tenant, session])
    const request = randomUUID()
    await a.query('begin')
    await scan(a, request)
    other = scan(b, request)
    await blocked()
    await a.query('commit')
    await other
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from stocktake_events where session_id=$1',
          [session],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: stocktake start, scan/replay and finish races serialize without duplicate sessions or lost observations.',
    )
  } finally {
    for (const c of clients) {
      await c.query('rollback').catch(() => {})
      await c.end()
    }
  }
}
