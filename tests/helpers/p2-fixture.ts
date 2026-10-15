import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { localTestUrl } from './local-services'
// Loopback-only fixtures. All domain writes run as an identified store owner.
export async function p2Fixture(email: string) {
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await db.connect()
  await db.query(
    readFileSync(
      new URL(
        '../../supabase/tests/bag-reception-fixture.inc',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const actor = (
    await db.query('select id from auth.users where email=$1', [email])
  ).rows[0].id
  await db.query('begin')
  await db.query('set local role authenticated')
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: actor, role: 'authenticated' }),
  ])
  const tenant = (
    await db.query('select create_tenant($1,$2,$3) id', [
      'P2 browser store',
      `p2-${randomUUID()}`,
      randomUUID(),
    ])
  ).rows[0].id
  const seller = (
    await db.query('select register_seller($1,$2,$3,$4,$5) id', [
      tenant,
      randomUUID(),
      'Synthetic P2 seller',
      `p2-seller-${randomUUID()}@example.test`,
      '',
    ])
  ).rows[0].id
  const agreement = (
    await db.query(
      'select publish_seller_agreement($1,$2,null,$3,$4,$5,false) id',
      [tenant, randomUUID(), 'Synthetic terms', 'Only a test', 'en'],
    )
  ).rows[0].id
  await db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
    tenant,
    randomUUID(),
    seller,
    agreement,
    'Synthetic paper agreement',
  ])
  await db.query(
    "select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy') || $3::jsonb)",
    [
      tenant,
      randomUUID(),
      JSON.stringify({
        vatModeConsignmentPrivate: 'consignment_margin',
        vatModeStoreOwned: 'store_full',
        markdownSteps: [{ afterDays: 0, percent: 10 }],
      }),
    ],
  )
  async function item(title: string, id: string = randomUUID()) {
    const bag = (
      await db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        tenant,
        randomUUID(),
        seller,
        '',
        agreement,
      ])
    ).rows[0].id
    const draft = randomUUID()
    await db.query(
      'select pg_temp.prepare_bag_reception($1,$2,$3,$4,0,$5,$6,$7)',
      [tenant, randomUUID(), bag, draft, title, 'Jackets', 'Good'],
    )
    await db.query("select accept_item($1,$2,'reception_review',$3,1,20000)", [
      tenant,
      id,
      draft,
    ])
    return id
  }
  async function asActor<T>(uid: string, work: () => Promise<T>): Promise<T> {
    await db.query('begin')
    try {
      await db.query('set local role authenticated')
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ])
      const result = await work()
      await db.query('commit')
      return result
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  return {
    asActor,
    db,
    actor,
    tenant,
    seller,
    agreement,
    item,
    commit: () => db.query('commit'),
    close: async () => {
      await db.query('rollback')
      await db.end()
    },
  }
}
