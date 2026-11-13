import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceExternalPhotoAI({ setup, connectionString }) {
  const previous = (
    await setup.query(
      "select central_app_tenant_id as tenant,current_setting('request.jwt.claims',true) as claims from platform_settings where only_row",
    )
  ).rows[0]
  const owner = randomUUID(),
    user = randomUUID(),
    request = randomUUID(),
    photo = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [owner, `${owner}@example.test`],
  )
  await setup.query(
    'insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',
    [user, `467${Date.now()}`],
  )
  await setup.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: owner, role: 'authenticated' }),
  ])
  const tenant = (
    await setup.query(
      "select create_tenant('Synthetic photo AI race',$1,$2) as id",
      [`ai-race-${randomUUID()}`, randomUUID()],
    )
  ).rows[0].id
  await setup.query('update platform_settings set central_app_tenant_id=$1', [
    tenant,
  ])
  await setup.query(
    "insert into komisio_private.seller_ai_runtime values(true,encode(extensions.digest(repeat('a',64),'sha256'),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash",
  )
  await setup.query(
    "insert into external_item_photos(id,owner_id,path,sha256,bytes) values($1,$2,$3,repeat('b',64),100)",
    [photo, user, `${user}/${photo}.jpg`],
  )
  await setup.query(
    "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
    [`${user}/${photo}.jpg`],
  )
  const clients = [0, 1].map(
    (i) =>
      new pg.Client({
        connectionString,
        application_name: `external_photo_race_${i}`,
      }),
  )
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role authenticated')
      await c.query(
        "select set_config('request.jwt.claims',$1,false),set_config('request.headers',$2,false)",
        [
          JSON.stringify({ sub: user, role: 'authenticated' }),
          JSON.stringify({ 'x-komisio-seller-ai': 'a'.repeat(64) }),
        ],
      )
    }
    await setup.query('begin')
    await setup.query('select 1 from tenants where id=$1 for update', [tenant])
    const calls = clients.map((c) =>
      c.query(
        "select begin_external_photo_analysis($1,$2,$3,'synthetic','sv') as result",
        [request, tenant, [photo]],
      ),
    )
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'external_photo_race_%' and wait_event_type='Lock'",
        )
      ).rows[0].n
      if (waiting === 2) break
      await pause(20)
    }
    await setup.query('commit')
    assert.equal(waiting, 2)
    assert.deepEqual(
      (await Promise.all(calls)).map((r) => r.rows[0].result.reserved).sort(),
      [false, true],
    )
    const completion = 'select complete_external_photo_analysis($1,$2,100,10)'
    await Promise.all(
      clients.map((c) =>
        c.query(completion, [
          request,
          JSON.stringify({
            description: 'Dress',
            brand: null,
            condition: 'good',
            notes: '',
          }),
        ]),
      ),
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from external_photo_ai_results where id=$1',
          [request],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: concurrent central photo analysis and completion reserve one provider call and save one result',
    )
  } finally {
    await setup.query('rollback')
    await Promise.allSettled(clients.map((c) => c.end()))
    await setup.query('update platform_settings set central_app_tenant_id=$1', [
      previous.tenant,
    ])
    await setup.query("select set_config('request.jwt.claims',$1,false)", [
      previous.claims ?? '',
    ])
  }
}
