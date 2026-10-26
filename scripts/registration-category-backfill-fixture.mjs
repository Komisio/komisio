import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function prepareRegistrationCategories(db) {
  const actor = randomUUID()
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `category-default-${actor}@example.test`],
  )
  await db.query('set role authenticated')
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: 'authenticated' }),
  ])
  const tenant = (
    await db.query('select create_tenant($1,$2,$3) id', [
      'Synthetic category defaults',
      `category-${actor}`,
      randomUUID(),
    ])
  ).rows[0].id
  await db.query(
    'select publish_store_policy($1,$2,null,(current_store_policy($1)->\'policy\')||\'{"vatModeStoreOwned":"store_full"}\')',
    [tenant, randomUUID()],
  )
  const items = []
  for (const [index, value] of [
    'Translated',
    'Shared',
    'Unmatched',
  ].entries()) {
    const purchase = (
      await db.query(
        "select register_purchase($1,$2,'Synthetic',10000,'Test only',false) id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    const item = (
      await db.query("select accept_item($1,$2,'purchase',$3,null,20000) id", [
        tenant,
        randomUUID(),
        purchase,
      ])
    ).rows[0].id
    await db.query(
      "select correct_item_attribute($1,$2,$3,'category',$4,'Test only')",
      [tenant, randomUUID(), item, value],
    )
    await db.query('select set_item_type($1,$2,$3)', [
      tenant,
      `migration_${index}`,
      {
        labels: { en: `Migration ${index}` },
        suggestedCategory: value,
        attributes: [],
      },
    ])
    items.push(item)
  }
  const category = randomUUID()
  // Registry entries appear after the original unlinked observations.
  for (const [id, name, sv] of [
    [category, 'Unique', 'Translated'],
    [randomUUID(), 'First', 'Shared'],
    [randomUUID(), 'Second', 'Shared'],
  ])
    await db.query('select create_item_category($1,$2,$3,$4)', [
      tenant,
      id,
      name,
      { en: name, sv },
    ])
  await db.query('reset role')
  return { tenant, category, items, actor }
}
export async function verifyRegistrationCategories(
  db,
  { tenant, category, items },
) {
  const links = (
    await db.query(
      'select i.id,(select category_id from item_category_links l where l.tenant_id=i.tenant_id and l.item_id=i.id order by seq desc limit 1) category from items i where i.tenant_id=$1 order by i.id',
      [tenant],
    )
  ).rows
  assert.equal(links.find((r) => r.id === items[0]).category, category)
  assert.equal(links.find((r) => r.id === items[1]).category, null)
  assert.equal(links.find((r) => r.id === items[2]).category, null)
  const types = (
    await db.query(
      'select slug,suggested_category_id,suggested_category from item_types where tenant_id=$1 and slug like $2 order by slug',
      [tenant, 'migration_%'],
    )
  ).rows
  assert.deepEqual(
    types.map((t) => t.suggested_category_id),
    [category, null, null],
  )
  assert.deepEqual(
    types.map((t) => t.suggested_category),
    ['Translated', 'Shared', 'Unmatched'],
  )
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
    'PASS: registration category migration links only unique item/type matches and preserves unmatched and ambiguous evidence.',
  )
}
