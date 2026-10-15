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
      [tenant, randomUUID(), JSON.stringify(selection), 'jacket'],
      [tenant, randomUUID(), JSON.stringify(selection), 'trousers'],
      'ITEM_CHANGED',
    )
    const facts = (
      await a.query('select item_label_facts($1,$2) facts', [tenant, item])
    ).rows[0].facts
    const expected = JSON.stringify({
      title: facts.title,
      category: '',
      version: 1,
    })
    await race(
      'select edit_inventory_row($1,$2,$3,$4,$5,$6,$7,null)',
      [
        tenant,
        randomUUID(),
        item,
        expected,
        'Synthetic floor lamp',
        'Lighting',
        'jacket',
      ],
      [
        tenant,
        randomUUID(),
        item,
        expected,
        'Synthetic reading lamp',
        'Lamps',
        'jacket',
      ],
      'ITEM_CHANGED',
    )
    await a.query(
      `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')||'{"vatModeConsignmentPrivate":"consignment_margin","agreementRequiredFor":[]}')`,
      [tenant, randomUUID()],
    )
    await a.query(
      "select publish_seller_agreement($1,$2,null,'Synthetic terms','Only a test','en',false)",
      [tenant, randomUUID()],
    )
    const session = (
      await a.query('select create_reception_session($1,$2,$3) id', [
        tenant,
        randomUUID(),
        seller,
      ])
    ).rows[0].id
    const group = (
      await a.query(
        "select create_assortment_group($1,$2,'Synthetic standard') id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const request = randomUUID()
    const receptionArgs = [
      tenant,
      request,
      session,
      seller,
      0,
      JSON.stringify({ description: 'Synthetic grouped item' }),
      20000,
      null,
      'trousers',
    ]
    await race(
      'select quick_receive_classified($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [...receptionArgs, group],
      [...receptionArgs, null],
      'REQUEST_CONFLICT',
    )
    assert.equal(
      (
        await a.query(
          'select count(*)::int n from items where tenant_id=$1 and origin_id=$2',
          [tenant, session],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await a.query(
          'select count(*)::int n from item_classification_versions v join items i on i.tenant_id=v.tenant_id and i.id=v.item_id where i.tenant_id=$1 and i.origin_id=$2',
          [tenant, session],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: simultaneous reception choices create exactly one item and one atomic assortment version.',
    )
    console.log(
      'PASS: concurrent bank, description and classification edits preserve the first committed version and reject stale writes.',
    )
  } finally {
    await setup.query('rollback')
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
