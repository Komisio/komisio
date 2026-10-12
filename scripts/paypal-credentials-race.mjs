import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

export async function racePayPalCredentials({ setup, sessions, tenant }) {
  const merchants = [randomUUID(), randomUUID()]
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }, i) =>
    c
      .query("select store_paypal_oauth($1,$2,$3,now()+interval '1 hour',0)", [
        tenant,
        merchants[i],
        { iv: 'aWl2', tag: 'dGFn', data: 'ZGF0YQ==' },
      ])
      .then(
        () => 'saved',
        (error) => {
          if (error.message === 'ZETTLE_WRONG_MERCHANT') return 'refused'
          throw error
        },
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
  assert.deepEqual((await Promise.all(attempts)).sort(), ['refused', 'saved'])
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from paypal_credentials where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    1,
  )
  await setup.query(
    "update paypal_credentials set expires_at=now()-interval '1 second' where tenant_id=$1",
    [tenant],
  )
  const claims = await Promise.all(
    sessions.map(({ c }) =>
      c.query('select claim_paypal_refresh($1,1,$2) result', [
        tenant,
        randomUUID(),
      ]),
    ),
  )
  assert.deepEqual(claims.map((r) => r.rows[0].result.status).sort(), [
    'busy',
    'claimed',
  ])
  console.log(
    'PASS: concurrent OAuth connections pin one merchant; only one worker claims token renewal.',
  )
}
