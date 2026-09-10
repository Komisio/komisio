// Concurrency check for R2: two sessions approve payouts for the same consignor
// at the same time. The balance is 60; each payout is 50. Exactly one must
// succeed. pgTAP runs in a single session and cannot express this, so it lives
// here. Run against a local Supabase: `node scripts/payout-race.mjs`.
//
// Requires: npm i pg   and   DATABASE_URL (defaults to the supabase CLI local db).

import pg from 'pg'

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const T = '10000000-0000-0000-0000-000000000001'
const S = '10000000-0000-0000-0000-0000000000a1'
const I = '10000000-0000-0000-0000-00000000c001'
const D = '10000000-0000-0000-0000-00000000d001'
const P1 = '10000000-0000-0000-0000-00000000e001'
const P2 = '10000000-0000-0000-0000-00000000e002'

const actor = (c) => c.query(`select set_config('komisio.actor_type','system',false), set_config('komisio.actor_id','race',false)`)

async function setup(c) {
  await actor(c)
  await c.query(`delete from tenants where id = $1`, [T]).catch(() => {})
  await c.query(`insert into tenants (id, slug, name) values ($1, 'race', 'Race')`, [T])
  await c.query(`insert into sellers (id, tenant_id, display_name) values ($1, $2, 'Racer')`, [S, T])
  await c.query(`insert into items (id, tenant_id, seller_id, title, commission_pct, commission_incl_vat, initial_price, status)
                 values ($1, $2, $3, 'Jug', 40, true, 100, 'priced')`, [I, T, S])
  await c.query(`select transition_item($1, 'for_sale')`, [I])
  await c.query(`insert into sales (id, tenant_id, channel) values ($1, $2, 'manual')`, [D, T])
  await c.query(`select record_sale_line($1, $2, 100)`, [D, I])
  await c.query(`insert into payouts (id, tenant_id, seller_id, amount, method) values ($1, $3, $4, 50, 'swish'), ($2, $3, $4, 50, 'swish')`, [P1, P2, T, S])
}

async function approve(id) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  await actor(c)
  try {
    await c.query('begin')
    await c.query(`select transition_payout($1, 'approved')`, [id])
    await c.query('commit')
    return 'approved'
  } catch (e) {
    await c.query('rollback').catch(() => {})
    return e.code === 'P0002' ? 'refused' : `error:${e.message}`
  } finally {
    await c.end()
  }
}

const main = new pg.Client({ connectionString: url })
await main.connect()
await setup(main)

const results = await Promise.all([approve(P1), approve(P2)])
const { rows } = await main.query(`select balance from seller_balances where seller_id = $1`, [S])
await main.query(`delete from tenants where id = $1`, [T])
await main.end()

const ok = results.filter((r) => r === 'approved').length === 1 && Number(rows[0].balance) === 10
console.log(results, 'balance', rows[0].balance, ok ? 'OK' : 'FAIL')
process.exit(ok ? 0 : 1)
