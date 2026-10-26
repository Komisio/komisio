import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceItemCollection({ setup, connectionString }) {
  const user = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [user, `${user}@example.test`],
  )
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  try {
    for (const c of clients) {
      await c.connect()
      await c.query(
        await readFile(
          new URL(
            '../supabase/tests/bag-reception-fixture.inc',
            import.meta.url,
          ),
          'utf8',
        ),
      )
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ])
    }
    const [a, b] = clients
    const tenant = (
      await a.query("select create_tenant('Collection race',$1,$2) id", [
        `collection-${user}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic seller','','123') id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const agreement = (
      await a.query(
        "select publish_seller_agreement($1,$2,null,'Synthetic terms','Test only','en',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    await a.query(
      "select record_agreement_evidence($1,$2,$3,$4,'Synthetic paper')",
      [tenant, randomUUID(), seller, agreement],
    )
    const bag = (
      await a.query("select receive_bag_with_agreement($1,$2,$3,'',$4) id", [
        tenant,
        randomUUID(),
        seller,
        agreement,
      ])
    ).rows[0].id
    const draft = randomUUID(),
      item = randomUUID(),
      end = randomUUID()
    await a.query(
      "select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,'Synthetic jacket','Jackets','Good')",
      [tenant, randomUUID(), bag, draft],
    )
    await a.query("select accept_item($1,$2,'reception_review',$3,1,20000)", [
      tenant,
      item,
      draft,
    ])
    await a.query("select end_sale_period($1,$2,$3,'return')", [
      tenant,
      end,
      item,
    ])
    const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid
    const collect = (client, id, expected, collected) =>
      client.query(
        "select record_item_collection($1,$2,$3,$4,$5,$6,(now() at time zone 'Europe/Stockholm')::date,'Synthetic check') id",
        [tenant, id, item, end, expected, collected],
      )
    const waitForLock = async () => {
      for (let i = 0; i < 100; i++) {
        if (
          (
            await setup.query(
              'select wait_event_type from pg_stat_activity where pid=$1',
              [pid],
            )
          ).rows[0]?.wait_event_type === 'Lock'
        )
          return
        await pause(10)
      }
      throw new Error('Collection did not wait for tenant lock')
    }
    // A duplicate request waits, then replays the same event.
    const first = randomUUID()
    await a.query('begin')
    await collect(a, first, null, false)
    const replay = collect(b, first, null, false)
    await waitForLock()
    await a.query('commit')
    assert.equal((await replay).rows[0].id, first)
    // Two screens based on the same observation cannot silently supersede each other.
    const second = randomUUID()
    await a.query('begin')
    await collect(a, second, first, true)
    const stale = collect(b, randomUUID(), first, false).then(
      () => null,
      (e) => e,
    )
    await waitForLock()
    await a.query('commit')
    assert.match((await stale).message, /ITEM_COLLECTION_CHANGED/)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from item_events where item_id=$1 and kind='collection_recorded'",
          [item],
        )
      ).rows[0].n,
      2,
    )
    assert.equal(
      (
        await setup.query(
          "select detail->>'collected' value from item_events where item_id=$1 and kind='collection_recorded' order by occurred_at desc limit 1",
          [item],
        )
      ).rows[0].value,
      'true',
    )
    console.log(
      'PASS: collection replay and stale-screen races serialize; exactly two immutable observations remain.',
    )
  } finally {
    await clients[0].query('rollback').catch(() => {})
    await Promise.all(clients.map((c) => c.end()))
  }
}
