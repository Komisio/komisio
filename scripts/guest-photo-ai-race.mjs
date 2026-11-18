import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceGuestPhotoAI({ setup, connectionString }) {
  const previous = (
    await setup.query(
      "select central_app_tenant_id as tenant,current_setting('request.jwt.claims',true) as claims from platform_settings where only_row",
    )
  ).rows[0]
  const runtime = (
    await setup.query(
      'select key_hash from komisio_private.seller_ai_runtime where singleton',
    )
  ).rows[0]
  const owner = randomUUID(),
    request = randomUUID(),
    photo = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [owner, `${owner}@example.test`],
  )
  await setup.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: owner, role: 'authenticated' }),
  ])
  const tenant = (
    await setup.query(
      "select create_tenant('Synthetic guest AI race',$1,$2) id",
      [`guest-race-${randomUUID()}`, randomUUID()],
    )
  ).rows[0].id
  await setup.query('update platform_settings set central_app_tenant_id=$1', [
    tenant,
  ])
  await setup.query(
    "insert into komisio_private.seller_ai_runtime values(true,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')) on conflict(singleton) do update set key_hash=excluded.key_hash",
  )
  const clients = [0, 1].map(
    (i) =>
      new pg.Client({
        connectionString,
        application_name: `guest_photo_race_${i}`,
      }),
  )
  try {
    for (const c of clients) {
      await c.connect()
      await c.query('set role anon')
      await c.query(
        "select set_config('request.jwt.claims',$1,false),set_config('request.headers',$2,false)",
        [
          '{"role":"anon"}',
          JSON.stringify({ 'x-komisio-seller-ai': 'a'.repeat(64) }),
        ],
      )
    }
    await setup.query('begin')
    await setup.query('select 1 from tenants where id=$1 for update', [tenant])
    const startedAt = new Date().toISOString()
    const calls = clients.map((c) =>
      c.query(
        "select begin_guest_photo_analysis($1,$2,repeat('b',64),repeat('c',64),repeat('d',64),$3,'sv','synthetic',$4) result",
        [request, tenant, [photo], startedAt],
      ),
    )
    let waiting = 0
    for (let i = 0; i < 100; i++) {
      waiting = (
        await setup.query(
          "select count(*)::int n from pg_stat_activity where application_name like 'guest_photo_race_%' and wait_event_type='Lock'",
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
    const output = JSON.stringify({
      description: 'Dress',
      brand: null,
      condition: 'good',
      notes: '',
      estimatedWeightG: 350,
    })
    await Promise.all(
      clients.map((c) =>
        c.query(
          "select complete_guest_photo_analysis($1,repeat('b',64),$2,$3,100,10)",
          [request, JSON.stringify(['e'.repeat(64)]), output],
        ),
      ),
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from guest_photo_ai_attempts where id=$1 and completed_at is not null',
          [request],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from usage_events where tenant_id=$1 and feature='reception_assistance'",
          [tenant],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: concurrent guest photo analysis reserves one model call, result and quota charge',
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
    if (runtime)
      await setup.query(
        'update komisio_private.seller_ai_runtime set key_hash=$1 where singleton',
        [runtime.key_hash],
      )
    else
      await setup.query(
        'delete from komisio_private.seller_ai_runtime where singleton',
      )
  }
}
