import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function raceCatalogueEditing({ setup, sessions, tenant }) {
  const [a, b] = sessions.map((s) => s.c)
  const category = randomUUID()
  await a.query('select create_item_category($1,$2,$3,$4)', [
    tenant,
    category,
    'Race category',
    { en: 'Race category' },
  ])
  const results = await Promise.allSettled(
    [a, b].map((c, i) =>
      c.query('select update_item_category($1,$2,$3,0,$4,$5,true)', [
        tenant,
        randomUUID(),
        category,
        `Edited ${i}`,
        { en: `Edited ${i}` },
      ]),
    ),
  )
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(
    results.find((r) => r.status === 'rejected').reason.message,
    /CATALOGUE_CHANGED/,
  )
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from item_category_versions where category_id=$1',
        [category],
      )
    ).rows[0].n,
    1,
  )
  const slug = `race_edit_${randomUUID().replaceAll('-', '').slice(0, 15)}`
  await a.query('select set_item_type($1,$2,$3)', [
    tenant,
    slug,
    {
      labels: { en: 'Race edit type' },
      attributes: [{ slug: 'description', expected: true, sort: 0 }],
    },
  ])
  const profile = (
    await a.query(
      "select t from jsonb_array_elements(attribute_vocabulary($1)->'types') t where t->>'slug'=$2",
      [tenant, slug],
    )
  ).rows[0].t
  const types = await Promise.allSettled(
    [a, b].map((c, i) =>
      c.query('select update_item_type($1,$2,$3,$4)', [
        tenant,
        slug,
        profile,
        {
          labels: { en: `Race changed ${i}` },
          suggestedCategory: '',
          active: true,
          attributes: profile.attributes,
        },
      ]),
    ),
  )
  assert.equal(types.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(
    types.find((r) => r.status === 'rejected').reason.message,
    /CATALOGUE_CHANGED/,
  )
  console.log(
    'PASS: concurrent category and type editors cannot overwrite each other.',
  )
}
