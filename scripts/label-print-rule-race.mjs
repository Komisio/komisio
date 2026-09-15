import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceLabelPrintRule({ setup, sessions, tenant }) {
  const printer = randomUUID()
  await sessions[0].c.query(
    "select register_printer($1,$2,'Synthetic','tcp','127.0.0.1:9100','',203,true)",
    [tenant, printer],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }) =>
    c.query("select set_label_print_rule($1,'item',$2,2,true) rule", [
      tenant,
      printer,
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
  const results = await Promise.all(attempts)
  assert.equal(waiting, 2)
  assert.deepEqual(results[0].rows, results[1].rows)
  assert.equal(
    (
      await setup.query(
        'select count(*)::int total from label_print_rules where tenant_id=$1',
        [tenant],
      )
    ).rows[0].total,
    1,
  )
  assert.equal(
    (
      await setup.query(
        "select count(*)::int total from access_events where tenant_id=$1 and action='label_print_rule.changed'",
        [tenant],
      )
    ).rows[0].total,
    1,
  )
  console.log(
    'PASS: concurrent identical label rules serialize to one row and one audit event.',
  )
}
