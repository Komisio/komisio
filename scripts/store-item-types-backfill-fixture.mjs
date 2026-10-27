import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Run against the schema immediately before #680, in a disposable database.
export async function prepareStoreItemTypes(db) {
  const actor = randomUUID()
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [actor, `types-${actor}@example.test`],
  )
  await db.query('set role authenticated')
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: 'authenticated' }),
  ])
  const stores = []
  for (let i = 0; i < 8; i++) {
    const tenant = (
      await db.query('select create_tenant($1,$2,$3) id', [
        'Synthetic type migration',
        `types-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    stores.push(tenant)
    if (i < 6) {
      // Older stores predate the shadow seed; ordinary deletion exposes the
      // platform fallback in the old schema without altering history.
      for (const slug of ['lamp', 'sweater'])
        await db.query("select delete_catalogue_record($1,'type',$2)", [
          tenant,
          slug,
        ])
    }
  }
  const [used, unused, custom, profile, proposal, settings, shadow, edited] =
    stores
  await db.query("select set_item_type($1,'lamp',$2)", [
    custom,
    {
      labels: { en: 'Store lamp' },
      active: false,
      attributes: [{ slug: 'brand', expected: true, sort: 9 }],
    },
  ])
  // A deliberately edited inactive shadow must survive even without usage.
  await db.query("select set_item_type($1,'lamp',$2)", [
    edited,
    { labels: { en: 'Archived lamps' }, active: false, attributes: [] },
  ])
  await db.query(
    "select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy') || $3::jsonb)",
    [
      used,
      randomUUID(),
      {
        vatModeStoreOwned: 'store_full',
        vatModeConsignmentPrivate: 'consignment_margin',
        intakeProfile: 'quick',
      },
    ],
  )
  const purchase = (
    await db.query(
      "select register_purchase_described($1,$2,'',100,'Synthetic receipt',false,'{}','lamp','') id",
      [used, randomUUID()],
    )
  ).rows[0].id
  const item = (
    await db.query("select accept_item($1,$2,'purchase',$3,null,20000) id", [
      used,
      randomUUID(),
      purchase,
    ])
  ).rows[0].id
  // A superseded classification still requires its type.
  await db.query("select classify_items($1,$2,$3,'sweater',null)", [
    used,
    randomUUID(),
    JSON.stringify([{ id: item, version: 0 }]),
  ])
  await db.query("select classify_items($1,$2,$3,'lamp',null)", [
    used,
    randomUUID(),
    JSON.stringify([{ id: item, version: 1 }]),
  ])
  const seller = (
    await db.query(
      "select register_seller($1,$2,'Synthetic seller',$3,'') id",
      [used, randomUUID(), `seller-${actor}@example.test`],
    )
  ).rows[0].id
  const session = (
    await db.query('select create_reception_session($1,$2,$3) id', [
      used,
      randomUUID(),
      seller,
    ])
  ).rows[0].id
  await db.query(
    'select quick_receive($1,$2,$3,$4,0,\'{"description":"Synthetic lamp"}\',20000,\'lamp\')',
    [used, randomUUID(), session, seller],
  )
  const beforeTypes = (
    await db.query('select attribute_vocabulary($1) v', [used])
  ).rows[0].v.types.filter((t) => ['lamp', 'sweater'].includes(t.slug))
  await db.query('reset role')
  await db.query(`
    insert into item_types(tenant_id,slug,labels,suggested_category,active,inherit_attributes)
    values(null,'legacy_inactive','{"en":"Archived type","sv":"Arkiverad typ"}','Legacy category',false,false);
    insert into item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort)
    values(null,'legacy_inactive','brand',true,7)`)
  // Existing profile overrides and staged/structured references are separate
  // migration cases: no accepted item is needed to keep their type.
  await db.query(
    "insert into item_type_attributes(tenant_id,type_slug,attribute_slug,expected,sort) values($1,'lamp','brand',true,99)",
    [profile],
  )
  await db.query(
    `insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at)
     values($1,$2,'publishReceptionReview','medium','{"suggestions":{"itemType":"lamp"}}','agent','Synthetic migration',$3,now()+interval '1 day')`,
    [randomUUID(), proposal, actor],
  )
  // Simulates an extensible tenant settings document, discovered through the
  // same catalog used for real settings. Exists only in the disposable test DB.
  await db.query(
    'create table public.type_migration_fixture_settings(tenant_id uuid, settings jsonb)',
  )
  await db.query('insert into type_migration_fixture_settings values($1,$2)', [
    settings,
    { nested: [{ type_slug: 'sweater' }, { itemType: 'legacy_inactive' }] },
  ])
  const history = await snapshotHistory(db, stores)
  return {
    actor,
    stores,
    used,
    unused,
    custom,
    profile,
    proposal,
    settings,
    shadow,
    edited,
    item,
    beforeTypes,
    history,
  }
}

async function snapshotHistory(db, stores) {
  const result = {}
  for (const table of [
    'items',
    'purchase_receipts',
    'reception_reviews',
    'reception_source_revisions',
    'item_classification_batches',
    'item_classification_versions',
    'pending_operations',
    'access_events',
  ])
    result[table] = (
      await db.query(
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') rows from public.${table} t where tenant_id=any($1::uuid[])`,
        [stores],
      )
    ).rows[0].rows
  return result
}

export async function verifyStoreItemTypes(db, f) {
  assert.deepEqual(await snapshotHistory(db, f.stores), f.history)
  const rows = (
    await db.query(
      "select tenant_id,slug,labels,active from item_types where tenant_id=any($1::uuid[]) and slug in ('lamp','sweater') order by tenant_id,slug",
      [f.stores],
    )
  ).rows
  const slugs = (tenant) =>
    rows.filter((r) => r.tenant_id === tenant).map((r) => r.slug)
  assert.deepEqual(slugs(f.used), ['lamp', 'sweater'])
  assert.deepEqual(slugs(f.unused), [])
  assert.deepEqual(slugs(f.shadow), [])
  assert.deepEqual(slugs(f.custom), ['lamp'])
  assert.deepEqual(slugs(f.profile), ['lamp'])
  assert.deepEqual(slugs(f.proposal), ['lamp'])
  assert.deepEqual(slugs(f.settings), ['sweater'])
  assert.deepEqual(slugs(f.edited), ['lamp'])
  assert.equal(
    rows.find((r) => r.tenant_id === f.custom).labels.en,
    'Store lamp',
  )
  assert.equal(rows.find((r) => r.tenant_id === f.edited).active, false)
  assert.deepEqual(
    (
      await db.query(
        "select labels,suggested_category,active,inherit_attributes from item_types where tenant_id=$1 and slug='legacy_inactive'",
        [f.settings],
      )
    ).rows,
    [
      {
        labels: { en: 'Archived type', sv: 'Arkiverad typ' },
        suggested_category: 'Legacy category',
        active: false,
        inherit_attributes: false,
      },
    ],
  )
  for (const [tenant, slug] of [
    [f.used, 'lamp'],
    [f.used, 'sweater'],
    [f.settings, 'legacy_inactive'],
  ]) {
    const profileRows = await db.query(
      `select tenant_id,attribute_slug,expected,sort from item_type_attributes
       where type_slug=$2 and (tenant_id=$1 or tenant_id is null) order by attribute_slug`,
      [tenant, slug],
    )
    const entries = (own) =>
      profileRows.rows
        .filter((r) => (r.tenant_id !== null) === own)
        .map(({ attribute_slug, expected, sort }) => ({
          attribute_slug,
          expected,
          sort,
        }))
    assert.deepEqual(entries(true), entries(false))
  }
  assert.deepEqual(
    (
      await db.query(
        "select expected,sort from item_type_attributes where tenant_id=$1 and type_slug='lamp' and attribute_slug='brand'",
        [f.profile],
      )
    ).rows,
    [{ expected: true, sort: 99 }],
  )
  await db.query('set role authenticated')
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: f.actor, role: 'authenticated' }),
  ])
  const vocabulary = (
    await db.query('select attribute_vocabulary($1) v', [f.used])
  ).rows[0].v
  assert.deepEqual(
    vocabulary.types.filter((t) => ['lamp', 'sweater'].includes(t.slug)),
    f.beforeTypes.map((t) => ({ ...t, own: true })),
  )
  assert.equal(
    (
      await db.query("select delete_catalogue_record($1,'type','lamp') r", [
        f.used,
      ])
    ).rows[0].r.ok,
    false,
  )
  await db.query('reset role')
  assert.equal(
    (
      await db.query(
        "select komisio_private.item_title($1,$2)->>'title' title",
        [f.used, f.item],
      )
    ).rows[0].title,
    'Lampa',
  )
  assert.ok(
    (
      await db.query(
        'select * from komisio_private.copy_used_shared_item_types()',
      )
    ).rows.every((r) => r.copied_types === 0),
  )
  console.log(
    'PASS: used shared types copied; unused/shadow types hidden; overrides, labels, fields, purchase/reception/classification history and tenant references preserved; copy rerun creates zero rows.',
  )
}
