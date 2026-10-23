import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import pg from 'pg'

export async function raceSalePayment({ setup, connectionString }) {
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
    for (const client of clients) {
      await client.connect()
      await client.query('set role authenticated')
      await client.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: actor, role: 'authenticated' }),
      ])
    }
    const [a, b] = clients
    const tenant = (
      await a.query("select create_tenant('Sale payment race',$1,$2) id", [
        `sale-payment-${actor}`,
        randomUUID(),
      ])
    ).rows[0].id
    await a.query(
      'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\'::jsonb)',
      [tenant, randomUUID()],
    )
    const purchase = (
      await a.query(
        "select register_purchase($1,$2,'Synthetic source',10000,'Synthetic receipt',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const item = randomUUID(),
      sale = randomUUID()
    await a.query("select accept_item($1,$2,'purchase',$3,null,25000)", [
      tenant,
      item,
      purchase,
    ])
    const record = (client, method, note) =>
      client.query(
        "select record_sale($1,$2,'manual','RACE-PAYMENT','2026-10-20T10:00:00Z','SEK',$3,$4) id",
        [
          tenant,
          sale,
          JSON.stringify([{ itemId: item, priceOre: 25000 }]),
          JSON.stringify({ paymentMethod: method, manualNote: note }),
        ],
      )
    async function blocked() {
      for (let i = 0; i < 200; i++) {
        if (
          (
            await setup.query(
              'select wait_event_type from pg_stat_activity where pid=$1',
              [b.processID],
            )
          ).rows[0]?.wait_event_type === 'Lock'
        )
          return
        await pause(10)
      }
      throw Error('Sale competitor did not reach tenant lock')
    }
    await a.query('begin')
    await record(a, 'mobilepay', 'MP-123')
    const competing = record(b, 'cash', 'different').then(
      () => null,
      (error) => error.message,
    )
    await blocked()
    await a.query('commit')
    assert.equal(await competing, 'SALE_CONFLICT')
    assert.equal((await record(b, 'mobilepay', 'MP-123')).rows[0].id, sale)
    const rows = (
      await setup.query(
        'select payment_method,staff_note from sales where tenant_id=$1',
        [tenant],
      )
    ).rows
    assert.deepEqual(rows, [
      { payment_method: 'mobilepay', staff_note: 'MP-123' },
    ])
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from sale_lines where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    await a.query('begin')
    const close = (
      await a.query("select generate_day_close($1,$2,'2026-10-20') id", [
        tenant,
        randomUUID(),
      ])
    ).rows[0].id
    const concurrentClose = b.query(
      "select generate_day_close($1,$2,'2026-10-20') id",
      [tenant, randomUUID()],
    )
    await blocked()
    await a.query('commit')
    assert.equal((await concurrentClose).rows[0].id, close)
    assert.equal(
      (
        await setup.query('select payment_totals from day_closes where id=$1', [
          close,
        ])
      ).rows[0].payment_totals.mobilepay.grossOre,
      25000,
    )
    console.log(
      'PASS: concurrent sale metadata conflicts cannot duplicate or mutate sales; day-close retries freeze one payment snapshot.',
    )
  } finally {
    for (const client of clients) {
      await client.query('rollback').catch(() => {})
      await client.end()
    }
  }
}
