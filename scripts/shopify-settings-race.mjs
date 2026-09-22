import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
export async function raceShopifySettings({ setup, sessions, tenant }) {
  await sessions[0].c.query(
    'select store_shopify_connection($1,\'race.myshopify.com\',\'Race\',\'SEK\',\'{"iv":"a","tag":"b","data":"c"}\',\'read_orders\',null)',
    [tenant],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const attempts = sessions.map(({ c }, i) =>
    c
      .query('select save_shopify_sync_settings($1,$2,0,$3)', [
        tenant,
        'race.myshopify.com',
        {
          mode: 'pos',
          locationId: `gid://shopify/Location/${i + 1}`,
          locationName: 'Synthetic',
          webPublicationId: null,
          posPublicationId: 'gid://shopify/Publication/1',
        },
      ])
      .then(
        () => 'saved',
        (e) => {
          if (e.message === 'SHOPIFY_SETTINGS_CHANGED') return 'stale'
          throw e
        },
      ),
  )
  let waiting = 0
  for (let i = 0; i < 100; i++) {
    waiting = (
      await setup.query(
        "select count(*)::int n from pg_stat_activity where application_name like 'owner_race_%' and wait_event_type='Lock'",
      )
    ).rows[0].n
    if (waiting === 2) break
    await pause(20)
  }
  await setup.query('commit')
  assert.equal(waiting, 2)
  assert.deepEqual((await Promise.all(attempts)).sort(), ['saved', 'stale'])
  assert.equal(
    (
      await setup.query(
        'select revision::text from komisio_private.shopify_sync_settings where tenant_id=$1',
        [tenant],
      )
    ).rows[0].revision,
    '1',
  )
  console.log(
    'PASS: concurrent Shopify location choices accept one revision and refuse the stale save.',
  )
}
