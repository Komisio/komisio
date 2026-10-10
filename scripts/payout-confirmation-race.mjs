import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function racePayoutConfirmation({ setup, connectionString }) {
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
        'Payment confirmation race',
        `payments-${user}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await a.query(
        "select register_seller($1,$2,'Synthetic payee',$3,'') id",
        [tenant, randomUUID(), `${randomUUID()}@example.test`],
      )
    ).rows[0].id
    await a.query(
      "select adjust_seller_ledger($1,$2,$3,100000,'Synthetic race balance')",
      [tenant, randomUUID(), seller],
    )
    const ids = Array.from({ length: 4 }, () => randomUUID())
    for (const id of ids) {
      await a.query('select request_payout($1,$2,$3,10000)', [
        tenant,
        id,
        seller,
      ])
      await a.query('select approve_payout($1,$2,$3)', [
        tenant,
        randomUUID(),
        id,
      ])
    }
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
      throw Error('Payment confirmation competitor did not reach lock')
    }
    const confirm = (client, batch, payouts) =>
      client.query("select confirm_payout_payments($1,$2,'SEK',$3::jsonb) id", [
        tenant,
        batch,
        JSON.stringify(
          payouts.map((payoutId) => ({
            payoutId,
            amountOre: 10000,
            reference: `SYNTHETIC-${payoutId}`,
          })),
        ),
      ])
    const batch = randomUUID()
    await a.query('begin')
    await confirm(a, batch, ids.slice(0, 2))
    const replay = confirm(b, batch, ids.slice(0, 2).reverse())
    await blocked()
    await a.query('commit')
    assert.equal((await replay).rows[0].id, batch)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='payout_paid'",
          [tenant],
        )
      ).rows[0].n,
      2,
    )
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='payout.payments_confirmed'",
          [tenant],
        )
      ).rows[0].n,
      1,
    )

    await a.query('begin')
    await a.query("select mark_payout_paid($1,$2,$3,'SYNTHETIC-INDIVIDUAL')", [
      tenant,
      randomUUID(),
      ids[2],
    ])
    const staleBatch = confirm(b, randomUUID(), ids.slice(2)).then(
      () => null,
      (e) => e,
    )
    await blocked()
    await a.query('commit')
    assert.match((await staleBatch).message, /PAYOUT_CHANGED/)
    assert.equal(
      (await setup.query('select status from payouts where id=$1', [ids[3]]))
        .rows[0].status,
      'approved',
    )

    await a.query('begin')
    await confirm(a, randomUUID(), [ids[3]])
    const rejection = b
      .query("select reject_payout($1,$2,$3,'Synthetic competing rejection')", [
        tenant,
        randomUUID(),
        ids[3],
      ])
      .then(
        () => null,
        (e) => e,
      )
    await blocked()
    await a.query('commit')
    assert.match((await rejection).message, /PAYOUT_DECIDED/)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from seller_ledger_entries where tenant_id=$1 and kind='payout_paid'",
          [tenant],
        )
      ).rows[0].n,
      4,
    )
    console.log(
      'PASS: batch confirmation replays once, stale overlapping batches write nothing and payment/rejection races preserve one outcome.',
    )
  } finally {
    for (const c of clients) {
      await c.query('rollback').catch(() => {})
      await c.end()
    }
  }
}
