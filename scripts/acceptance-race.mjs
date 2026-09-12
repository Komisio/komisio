import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

async function waitForLocks(setup, expected) {
  let waiting = 0
  for (let i = 0; i < 100; i++) {
    waiting = (
      await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].n
    if (waiting === expected) break
    await pause(20)
  }
  return waiting
}

/** One origin, two acceptances: exactly one item. Both sessions act as `actor`. */
export async function raceAcceptance({ setup, sessions, tenant, actor }) {
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
  const purchase = randomUUID()
  await sessions[0].c.query(
    "select register_purchase($1,$2,'Race purchase',15000,'Receipt R1',false)",
    [tenant, purchase],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }) =>
    c
      .query("select accept_item($1,$2,'purchase',$3,null,25000)", [
        tenant,
        randomUUID(),
        purchase,
      ])
      .then(
        () => 'accepted',
        (e) => {
          if (e.message.includes('ITEM_EXISTS')) return 'exists'
          throw e
        },
      ),
  )
  const waiting = await waitForLocks(setup, 2)
  await setup.query('commit')
  assert.equal(waiting, 2, 'both acceptances waited for the tenant lock')
  assert.deepEqual((await Promise.all(attempts)).sort(), ['accepted', 'exists'])
  assert.equal(
    (
      await setup.query(
        "select count(*)::int n from items where origin_kind='purchase' and origin_id=$1",
        [purchase],
      )
    ).rows[0].n,
    1,
    'one item per origin',
  )
  // Identical retries of one acceptance resolve to the same item.
  const purchase2 = randomUUID(),
    itemId = randomUUID()
  await sessions[0].c.query(
    "select register_purchase($1,$2,'Retry purchase',9900,'Receipt R2',true)",
    [tenant, purchase2],
  )
  const retries = await Promise.all(
    sessions.map(({ c }) =>
      c.query("select accept_item($1,$2,'purchase',$3,null,19900) as id", [
        tenant,
        itemId,
        purchase2,
      ]),
    ),
  )
  assert.ok(retries.every((r) => r.rows[0].id === itemId))
  const state = (
    await setup.query(
      "select (select count(*) from items where id=$1)::int items,(select count(*) from item_prices where item_id=$1)::int prices,(select count(*) from item_events where item_id=$1 and kind='accepted')::int accepted",
      [itemId],
    )
  ).rows[0]
  assert.deepEqual(state, { items: 1, prices: 1, accepted: 1 })
  console.log(
    'PASS: two acceptances of one origin yield one item; identical retries resolve the original.',
  )
}

/** One staged acceptance, two concurrent approvals by the same second person: one execution. */
export async function raceStagedAcceptance({
  setup,
  sessions,
  tenant,
  proposer,
  approver,
}) {
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: proposer, role: 'authenticated' }),
    ])
  const purchase = randomUUID(),
    proposal = randomUUID()
  await sessions[0].c.query(
    "select register_purchase($1,$2,'Staged purchase',12000,'Receipt R3',false)",
    [tenant, purchase],
  )
  await sessions[0].c.query(
    "select propose_operation($1,$2,'acceptItem',$3::jsonb,'race-agent',now()+interval '1 day')",
    [
      tenant,
      proposal,
      JSON.stringify({
        originKind: 'purchase',
        originId: purchase,
        originRevision: null,
        priceOre: 22000,
      }),
    ],
  )
  // The proposer's own identity may not approve a medium-risk kind.
  await assert.rejects(
    sessions[0].c.query("select decide_operation($1,$2,$3,'approved','')", [
      tenant,
      randomUUID(),
      proposal,
    ]),
    (e) => e.code === '42501',
  )
  for (const { c } of sessions)
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: approver, role: 'authenticated' }),
    ])
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const approvals = sessions.map(({ c }) =>
    c
      .query("select decide_operation($1,$2,$3,'approved','')", [
        tenant,
        randomUUID(),
        proposal,
      ])
      .then(
        () => 'decided',
        (e) => {
          if (e.message.includes('OPERATION_DECIDED')) return 'already'
          throw e
        },
      ),
  )
  const waiting = await waitForLocks(setup, 2)
  await setup.query('commit')
  assert.equal(waiting, 2)
  assert.deepEqual((await Promise.all(approvals)).sort(), [
    'already',
    'decided',
  ])
  const state = (
    await setup.query(
      'select (select count(*) from operation_decisions where operation_id=$1)::int decisions,(select outcome from operation_decisions where operation_id=$1) outcome,(select count(*) from items where id=$1)::int items,(select accepted_by from items where id=$1) accepted_by',
      [proposal],
    )
  ).rows[0]
  assert.deepEqual(state, {
    decisions: 1,
    outcome: 'executed',
    items: 1,
    accepted_by: approver,
  })
  console.log(
    'PASS: an agent-proposed acceptance executes once under concurrent approvals, by the approver, never the proposer.',
  )
}
