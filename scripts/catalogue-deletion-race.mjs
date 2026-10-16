import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceCatalogueDeletion({ setup, sessions, tenant }) {
  const [writer, remover] = sessions.map(({ c }) => c)
  const slug = `race_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  await writer.query('select set_attribute_definition($1,$2,$3)', [
    tenant,
    slug,
    { dataType: 'text', labels: { en: 'Synthetic race field' } },
  ])
  await writer.query('begin')
  await writer.query('select set_item_type($1,$2,$3)', [
    tenant,
    slug,
    { labels: { en: 'Synthetic race type' }, attributes: [{ slug }] },
  ])
  const deletion = remover.query(
    "select delete_catalogue_record($1,'attribute',$2) result",
    [tenant, slug],
  )
  let waiting = 0
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
        )
      ).rows[0].n
      if (waiting === 1) break
      await pause(20)
    }
  } finally {
    await writer.query('commit')
  }
  const result = (await deletion).rows[0].result
  assert.equal(waiting, 1, 'deletion waits for the reference writer')
  assert.equal(result.ok, false)
  assert.equal(result.usage.profiles, 1)
  await writer.query("select delete_catalogue_record($1,'type',$2)", [
    tenant,
    slug,
  ])
  // Simultaneous retries remove the record once and produce one audit event.
  const retries = await Promise.all(
    sessions.map(({ c }) =>
      c.query("select delete_catalogue_record($1,'attribute',$2) result", [
        tenant,
        slug,
      ]),
    ),
  )
  assert.ok(retries.every((r) => r.rows[0].result.ok))
  await assert.rejects(
    writer.query('select set_item_type($1,$2,$3)', [
      tenant,
      slug,
      { labels: { en: 'Stale editor' }, attributes: [{ slug }] },
    ]),
    /ATTRIBUTE_UNDEFINED/,
  )
  assert.equal(
    (
      await setup.query(
        "select count(*)::int n from access_events where tenant_id=$1 and action='catalogue.deleted' and detail->>'kind'='attribute' and detail->>'key'=$2",
        [tenant, slug],
      )
    ).rows[0].n,
    1,
  )
  console.log('PASS: catalogue deletion serializes with linking and retries.')
}
