import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceItemRegistration({ setup, sessions }) {
  const [a, b] = sessions.map((s) => s.c)
  const tenant = (
    await a.query('select create_tenant($1,$2,$3) id', [
      'Synthetic registration race',
      `registration-${randomUUID()}`,
      randomUUID(),
    ])
  ).rows[0].id
  await setup.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
    [tenant, sessions[1].uid],
  )
  async function race(queries, code) {
    await setup.query('begin')
    await setup.query('select id from tenants where id=$1 for update', [tenant])
    const attempts = [a, b].map((c, i) => c.query(...queries[i]))
    // Attach rejection handlers before either blocked transaction can finish.
    const settled = Promise.allSettled(attempts)
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
    const results = await settled
    assert.equal(waiting, 2)
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(
      results.filter(
        (r) => r.status === 'rejected' && r.reason.message === code,
      ).length,
      1,
    )
    const winner = results.findIndex((r) => r.status === 'fulfilled')
    await [a, b][winner].query(...queries[winner])
  }
  const settings = {
    descriptionRequired: false,
    titleTemplate: '{brand} {size}',
    attributes: ['brand', 'size'],
  }
  await race(
    [a, b].map(() => [
      'select publish_registration_settings($1,$2,null,$3)',
      [tenant, randomUUID(), settings],
    ]),
    'REGISTRATION_CHANGED',
  )
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from item_registration_settings where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    1,
  )
  const purchase = randomUUID()
  await a.query(
    "select register_purchase($1,$2,'Synthetic',10000,'Receipt',false)",
    [tenant, purchase],
  )
  await race(
    [a, b].map((_, i) => [
      "select save_item_internal_note($1,$2,'purchase',$3,null,$4)",
      [tenant, randomUUID(), purchase, `PRIVATE ${i}`],
    ]),
    'NOTE_CHANGED',
  )
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from item_internal_notes where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'PASS: concurrent registration settings and private notes reject stale writes; retries append no duplicate.',
  )
}
