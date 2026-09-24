import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceShopifyPrivacy({ setup, sessions, tenant }) {
  for (const { c } of sessions) {
    const uid = (await c.query('select auth.uid() id')).rows[0].id
    await setup.query(
      'select komisio_private.register_shopify_privacy_actor($1)',
      [uid],
    )
  }
  const fingerprint = 'd'.repeat(64)
  await setup.query('begin')
  await setup.query(
    "select pg_advisory_xact_lock(hashtextextended('shopify-privacy:shop/redact:race.myshopify.com:'||$1,0))",
    [fingerprint],
  )
  const attempts = sessions.map(({ c }) =>
    c.query(
      'select receive_shopify_privacy(\'shop/redact\',\'race.myshopify.com\',$1,\'{"iv":"a","tag":"b","data":"c"}\') result',
      [fingerprint],
    ),
  )
  let waiting = 0
  for (let i = 0; i < 100; i++) {
    waiting = (
      await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].n
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  assert.equal(waiting, 2)
  assert.deepEqual(
    (await Promise.all(attempts)).map((r) => r.rows[0].result.replayed).sort(),
    [false, true],
  )
  const request = (
    await sessions[0].c.query('select shopify_privacy_queue($1) q', [tenant])
  ).rows[0].q[0]
  await setup.query('begin')
  await setup.query(
    'select id from shopify_privacy_requests where id=$1 for update',
    [request.id],
  )
  const decisions = sessions.map(({ c }, i) =>
    c
      .query(
        "select record_shopify_privacy_outcome($1,null,$2,'processing',$3)",
        [request.id, randomUUID(), `Synthetic reviewer ${i}`],
      )
      .then(
        () => 'saved',
        (e) => {
          if (e.message === 'REQUEST_CONFLICT') return 'stale'
          throw e
        },
      ),
  )
  waiting = 0
  for (let i = 0; i < 100; i++) {
    waiting = (
      await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].n
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  assert.equal(waiting, 2)
  assert.deepEqual((await Promise.all(decisions)).sort(), ['saved', 'stale'])
  console.log(
    'PASS: concurrent Shopify privacy deliveries record once; concurrent handling rejects stale outcomes.',
  )
}
