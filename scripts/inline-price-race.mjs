import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
export async function raceInlinePrice({ setup, sessions }) {
  const [a, b] = sessions.map((s) => s.c)
  const tenant = (
    await a.query('select create_tenant($1,$2,$3) id', [
      'Synthetic price race',
      `price-${randomUUID()}`,
      randomUUID(),
    ])
  ).rows[0].id
  await setup.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')",
    [tenant, sessions[1].uid],
  )
  await a.query(
    'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\')',
    [tenant, randomUUID()],
  )
  const purchase = randomUUID(),
    item = randomUUID(),
    ids = [randomUUID(), randomUUID()]
  await a.query(
    "select register_purchase($1,$2,'Synthetic price item',10000,'Synthetic receipt',false)",
    [tenant, purchase],
  )
  await a.query("select accept_item($1,$2,'purchase',$3,null,20000)", [
    tenant,
    item,
    purchase,
  ])
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = [a, b].map((c, i) =>
    c.query("select set_item_price_checked($1,$2,$3,$4,'',20000) id", [
      tenant,
      ids[i],
      item,
      i ? 14000 : 15000,
    ]),
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
  const results = await Promise.allSettled(attempts)
  assert.equal(waiting, 2)
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(
    results.filter(
      (r) =>
        r.status === 'rejected' && r.reason.message === 'ITEM_PRICE_CHANGED',
    ).length,
    1,
  )
  const winner = results.findIndex((r) => r.status === 'fulfilled')
  await [a, b][winner].query(
    "select set_item_price_checked($1,$2,$3,$4,'',20000)",
    [tenant, ids[winner], item, winner ? 14000 : 15000],
  )
  assert.equal(
    (
      await setup.query(
        "select count(*)::int n from item_prices where tenant_id=$1 and item_id=$2 and reason='manual'",
        [tenant, item],
      )
    ).rows[0].n,
    1,
  )
  console.log(
    'PASS: concurrent inline price edits reject the stale amount; a lost-response retry records one price.',
  )
}
