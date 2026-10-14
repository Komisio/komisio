import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceSellerPrivacy({ setup, sessions, tenant }) {
  const seller = randomUUID()
  await sessions[0].c.query('select register_seller($1,$2,$3,$4,$5)', [
    tenant,
    seller,
    'Privacy race',
    'privacy-race@example.test',
    '',
  ])
  const preview = (
    await sessions[0].c.query('select seller_privacy_preview($1,$2) p', [
      tenant,
      seller,
    ])
  ).rows[0].p
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const erase = sessions[0].c
    .query('select erase_seller_contact($1,$2,$3,$4,$5,current_date+30,true)', [
      tenant,
      randomUUID(),
      seller,
      preview.revision,
      'Reviewed remaining records',
    ])
    .then(
      () => 'erased',
      (e) => {
        if (e.message === 'PRIVACY_CHANGED') return 'stale'
        throw e
      },
    )
  const receive = sessions[1].c
    .query("select receive_bag($1,$2,$3,'')", [tenant, randomUUID(), seller])
    .then(
      () => 'received',
      (e) => {
        if (e.message === 'SELLER_CLOSED') return 'closed'
        throw e
      },
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
  const result = await Promise.all([erase, receive])
  assert.ok(
    JSON.stringify(result) === JSON.stringify(['erased', 'closed']) ||
      JSON.stringify(result) === JSON.stringify(['stale', 'received']),
  )
  const state = (
    await setup.query(
      'select privacy_closed_at,(select count(*)::int from bag_receipts where seller_id=$1) bags from sellers where id=$1',
      [seller],
    )
  ).rows[0]
  assert.equal(state.privacy_closed_at !== null, state.bags === 0)
  console.log(
    'PASS: seller erasure and incoming goods serialize; no closed seller receives new custody.',
  )
}
