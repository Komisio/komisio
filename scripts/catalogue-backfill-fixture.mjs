import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Runs before the category migration in the disposable concurrency database.
export async function prepareCategoryBackfill(db) {
  const actor = randomUUID()
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `category-migration-${actor}@example.test`],
  )
  await db.query('set role authenticated')
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: 'authenticated' }),
  ])
  const tenant = (
    await db.query('select create_tenant($1,$2,$3) id', [
      'Synthetic migration',
      `migration-${actor}`,
      randomUUID(),
    ])
  ).rows[0].id
  const category = randomUUID()
  await db.query('select create_item_category($1,$2,$3,$4)', [
    tenant,
    category,
    'Unique',
    { en: 'Unique', sv: 'Translated' },
  ])
  for (const name of ['Ambiguous one', 'Ambiguous two'])
    await db.query('select create_item_category($1,$2,$3,$4)', [
      tenant,
      randomUUID(),
      name,
      { en: name, sv: 'Shared' },
    ])
  await db.query(
    'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\')',
    [tenant, randomUUID()],
  )
  const items = []
  for (const value of [' translated ', 'Shared', 'Unmatched']) {
    const purchase = (
      await db.query('select register_purchase($1,$2,$3,10000,$4,false) id', [
        tenant,
        randomUUID(),
        'Synthetic migration item',
        'Synthetic receipt',
      ])
    ).rows[0].id
    const item = (
      await db.query("select accept_item($1,$2,'purchase',$3,null,20000) id", [
        tenant,
        randomUUID(),
        purchase,
      ])
    ).rows[0].id
    await db.query(
      "select correct_item_attribute($1,$2,$3,'category',$4,'Synthetic migration test')",
      [tenant, randomUUID(), item, value],
    )
    items.push(item)
  }
  await db.query('reset role')
  return { tenant, category, items }
}
export async function verifyCategoryBackfill(db, fixture) {
  const { tenant, category, items } = fixture
  const links = (
    await db.query(
      'select item_id,category_id,label_key from item_category_links where tenant_id=$1',
      [tenant],
    )
  ).rows
  assert.deepEqual(links, [
    { item_id: items[0], category_id: category, label_key: 'sv' },
  ])
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from item_attribute_corrections where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    3,
  )
  console.log(
    'PASS: migration links only unique translated categories and preserves source corrections.',
  )
}
