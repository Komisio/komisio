import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceConsignmentFees({ setup, connectionString }) {
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
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: 'authenticated' }),
      ])
    }
    const [a, b] = clients
    const tenant = (
      await a.query('select create_tenant($1,$2,$3) id', [
        'Fee race',
        `fee-${user}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic seller',$3,'') id",
        [tenant, randomUUID(), `${randomUUID()}@example.test`],
      )
    ).rows[0].id
    await a.query(
      `select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy') || '{"consignmentPeriod":{"months":3,"collectionDays":2,"monthlyFee":{"amountOre":10000,"vatBasis":"inclusive","vatRatePercent":25,"collection":"balance"}}}')`,
      [tenant, randomUUID()],
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
      throw Error('Fee competitor did not reach lock')
    }
    const receive = (c) =>
      c.query("select receive_bag($1,$2,$3,'Concurrent delivery') id", [
        tenant,
        randomUUID(),
        seller,
      ])
    await a.query('begin')
    const bag = (await receive(a)).rows[0].id
    const other = receive(b)
    await blocked()
    await a.query('commit')
    await other
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from consignment_fees where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_consignment_periods where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    const draft = randomUUID(),
      item = randomUUID()
    await a.query(
      "select save_inspection_draft($1,$2,$3,$4,0,'Coat','Coats','Good')",
      [tenant, randomUUID(), bag, draft],
    )
    await a.query("select accept_item($1,$2,'inspection_draft',$3,1,50000)", [
      tenant,
      item,
      draft,
    ])
    const period = (
      await setup.query(
        'select id from seller_consignment_periods where tenant_id=$1',
        [tenant],
      )
    ).rows[0].id
    // Two worker connections use the database-only scheduler primitive.
    await a.query('reset role')
    await b.query('reset role')
    const accrue = (c) =>
      c.query(
        "select komisio_private.accrue_consignment_fees($1,now()+interval '2 months 1 hour',$2)",
        [period, user],
      )
    await a.query('begin')
    await accrue(a)
    const renewal = accrue(b)
    await blocked()
    await a.query('commit')
    await renewal
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from consignment_fees where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      3,
    )
    for (const c of clients) await c.query('set role authenticated')
    const fee = (
      await setup.query(
        'select id from consignment_fees where period_id=$1 order by month_index limit 1',
        [period],
      )
    ).rows[0].id
    const reversal = randomUUID()
    const reverse = (c) =>
      c.query(
        "select reverse_consignment_fee($1,$2,$3,'Synthetic correction')",
        [tenant, reversal, fee],
      )
    await a.query('begin')
    await reverse(a)
    const retry = reverse(b)
    await blocked()
    await a.query('commit')
    await retry
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='consignment_fee_reversal'",
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: simultaneous deliveries share one seller month; concurrent renewals and corrections charge or reverse exactly once.',
    )
  } finally {
    for (const c of clients) {
      await c.query('rollback').catch(() => {})
      await c.end()
    }
  }
}
