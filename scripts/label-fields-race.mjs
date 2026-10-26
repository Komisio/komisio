import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceLabelFields({ setup, sessions, tenant }) {
  const clients = sessions.map((s) => s.c)
  const ids = [randomUUID(), randomUUID()]
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const writes = clients.map((c, i) =>
    c.query('select set_item_label_fields($1,$2,0,$3::text[]) id', [
      tenant,
      ids[i],
      i ? ['size'] : ['brand'],
    ]),
  )
  let waiting = 0
  for (let attempt = 0; attempt < 100; attempt++) {
    waiting = (
      await setup.query(
        "select count(*)::int waiting from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].waiting
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  const results = await Promise.allSettled(writes)
  assert.equal(waiting, 2)
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    results.filter(
      (r) =>
        r.status === 'rejected' && r.reason.message === 'LABEL_FIELDS_CHANGED',
    ).length,
    1,
  )
  const winner = results.findIndex((r) => r.status === 'fulfilled')
  const fields = winner ? ['size'] : ['brand']
  assert.equal(
    (
      await clients[winner].query(
        'select set_item_label_fields($1,$2,0,$3::text[]) id',
        [tenant, ids[winner], fields],
      )
    ).rows[0].id,
    ids[winner],
  )
  const read = (
    await clients[0].query('select item_label_fields($1) value', [tenant])
  ).rows[0].value
  assert.deepEqual(read, { revision: 1, fields })
  await clients[0].query('select set_item_label_fields($1,$2,1,null)', [
    tenant,
    randomUUID(),
  ])
  console.log(
    'PASS: concurrent label field editors cannot overwrite each other; identical retries keep one revision.',
  )
}
