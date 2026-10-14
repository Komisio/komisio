import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceStoreWorkflow({ setup, connectionString }) {
  const actor = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `${actor}@example.test`],
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
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const [a] = clients
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Synthetic workflow',
        `workflow-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic seller',$3,'') id",
        [tenant, randomUUID(), `${actor}@example.test`],
      )
    ).rows[0].id
    const account = {
      holder: 'Synthetic holder',
      country: 'SE',
      kind: 'local',
      account: '123456789',
      routing: '1234',
    }
    async function race(sql, argsA, argsB, conflict) {
      await setup.query('begin')
      await setup.query('select id from tenants where id=$1 for update', [
        tenant,
      ])
      const outcomes = clients.map((c, index) =>
        c.query(sql, index === 0 ? argsA : argsB).then(
          () => 'saved',
          (e) => {
            if (e.message === conflict) return 'stale'
            throw e
          },
        ),
      )
      let waiting = 0
      for (let i = 0; i < 200; i++) {
        waiting = (
          await setup.query(
            "select count(*)::int n from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'",
            [clients.map((c) => c.processID)],
          )
        ).rows[0].n
        if (waiting === 2) break
        await pause(20)
      }
      await setup.query('commit')
      assert.equal(waiting, 2)
      assert.deepEqual((await Promise.all(outcomes)).sort(), ['saved', 'stale'])
    }
    await race(
      'select save_seller_bank_details($1,$2,$3,null,$4)',
      [tenant, randomUUID(), seller, account],
      [tenant, randomUUID(), seller, { ...account, account: '987654321' }],
      'BANK_DETAILS_CHANGED',
    )
    await a.query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy')||'{"vatModeStoreOwned":"store_full"}')`,
      [tenant, randomUUID()],
    )
    const receipt = randomUUID(),
      item = randomUUID()
    await a.query(
      "select register_purchase($1,$2,'Synthetic lamp',10000,'Synthetic receipt',false)",
      [tenant, receipt],
    )
    await a.query("select accept_item($1,$2,'purchase',$3,null,20000)", [
      tenant,
      item,
      receipt,
    ])
    await race(
      'select edit_item_description($1,$2,$3,$4,$5)',
      [tenant, randomUUID(), item, 'Synthetic lamp', 'Synthetic desk lamp'],
      [tenant, randomUUID(), item, 'Synthetic lamp', 'Synthetic table lamp'],
      'ITEM_CHANGED',
    )
    const selection = [{ id: item, version: 0 }]
    await race(
      'select classify_items($1,$2,$3,$4,null)',
      [tenant, randomUUID(), JSON.stringify(selection), 'lamp'],
      [tenant, randomUUID(), JSON.stringify(selection), 'sweater'],
      'ITEM_CHANGED',
    )
    console.log(
      'PASS: concurrent bank, description and classification edits preserve the first committed version and reject stale writes.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
