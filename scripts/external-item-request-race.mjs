import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceExternalRequests({ setup, connectionString }) {
  const owner = randomUUID(),
    staff = randomUUID()
  let tenant
  const previous = (
    await setup.query(
      'select central_app_tenant_id,central_app_revision from platform_settings where only_row',
    )
  ).rows[0]
  await setup.query(
    'insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',
    [owner, '46700006199'],
  )
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [staff, 'external-race@example.test'],
  )
  const clients = Array.from(
    { length: 3 },
    (_, i) =>
      new pg.Client({
        connectionString,
        application_name: `external_request_race_${i}`,
      }),
  )
  const [a, b, reviewer] = clients
  const photo = randomUUID(),
    path = `${owner}/${photo}.jpg`
  const submit = (c, id, store = tenant, image = photo) =>
    c.query(
      "select submit_external_item_request($1,$2,'Jacket','','good','',10000,'SEK',$3,'SE') as id",
      [id, store, [image]],
    )
  const outcome = (promise) =>
    promise.then(
      () => 'saved',
      (error) => error.message,
    )
  async function together(start) {
    await setup.query('begin')
    await setup.query('select komisio_private.lock_external_owner($1)', [owner])
    const attempts = start()
    let waiting = 0
    try {
      for (let i = 0; i < 200; i++) {
        waiting = (
          await setup.query(
            "select count(*)::int n from pg_stat_activity where application_name like 'external_request_race_%' and wait_event_type='Lock'",
          )
        ).rows[0].n
        if (waiting === 2) break
        await pause(10)
      }
    } finally {
      await setup.query('commit')
    }
    const results = await Promise.all(attempts)
    assert.equal(
      waiting,
      2,
      'both connections must actually contend on the lock',
    )
    return results.sort()
  }
  try {
    for (let i = 0; i < clients.length; i++) {
      await clients[i].connect()
      await clients[i].query('set role authenticated')
      await clients[i].query(
        "select set_config('request.jwt.claims',$1,false)",
        [
          JSON.stringify({
            sub: i === 2 ? staff : owner,
            role: 'authenticated',
          }),
        ],
      )
    }
    const stores = []
    for (let i = 0; i < 2; i++) {
      const requestId = randomUUID()
      const created = await reviewer.query(
        'select create_tenant($1,$2,$3) as id',
        ['Synthetic request race', `external-race-${requestId}`, requestId],
      )
      const store = created.rows[0].id
      stores.push(store)
      await reviewer.query(
        "select publish_store_policy($1,$2,null,(current_store_policy($1)->'policy')||'{\"externalAppSubmissionsEnabled\":true}'::jsonb)",
        [store, randomUUID()],
      )
    }
    ;[tenant] = stores
    await setup.query(
      "insert into platform_hosts(user_id,kind) values($1,'person')",
      [staff],
    )
    async function designate(target) {
      const current = (
        await reviewer.query('select host_central_app_intake() as s')
      ).rows[0].s
      return reviewer.query('select set_central_app_intake($1,$2,$3)', [
        randomUUID(),
        current.revision,
        target,
      ])
    }
    await designate(tenant)
    await a.query("select reserve_external_item_photo($1,repeat('a',64),100)", [
      photo,
    ])
    await a.query(
      "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
      [path],
    )
    const original = randomUUID()
    await a.query('begin')
    await submit(a, original)
    const pausing = designate(null)
    let blocked = false
    for (let i = 0; i < 200; i++) {
      blocked = (
        await setup.query(
          "select exists(select 1 from pg_stat_activity where application_name='external_request_race_2' and wait_event_type='Lock') as yes",
        )
      ).rows[0].yes
      if (blocked) break
      await pause(10)
    }
    await a.query('commit')
    await pausing
    assert.equal(
      blocked,
      true,
      'host pause must wait for the accepted submission transaction',
    )
    await submit(a, original)
    assert.equal(await outcome(submit(a, randomUUID())), 'STORE_UNAVAILABLE')
    await designate(tenant)
    for (let i = 0; i < 8; i++) await submit(a, randomUUID())
    assert.deepEqual(
      await together(() => [
        outcome(submit(a, randomUUID())),
        outcome(submit(b, randomUUID())),
      ]),
      ['ACTIVE_REQUEST_LIMIT', 'saved'],
    )
    assert.equal(
      (await a.query('select my_external_item_requests() as result')).rows[0]
        .result.activeCount,
      10,
    )
    assert.deepEqual(
      await together(() => [
        outcome(submit(a, original)),
        outcome(submit(b, original)),
      ]),
      ['saved', 'saved'],
    )
    assert.equal(
      (await a.query('select my_external_item_requests() as result')).rows[0]
        .result.activeCount,
      10,
    )

    await reviewer.query("select decline_external_item_request($1,$2,$3,'')", [
      randomUUID(),
      tenant,
      original,
    ])
    const nextPhoto = randomUUID()
    await a.query("select reserve_external_item_photo($1,repeat('b',64),100)", [
      nextPhoto,
    ])
    await a.query(
      "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
      [`${owner}/${nextPhoto}.jpg`],
    )
    const results = await together(() => [
      outcome(submit(a, randomUUID(), tenant, nextPhoto)),
      outcome(b.query('select discard_external_item_photo($1)', [nextPhoto])),
    ])
    assert.ok(
      JSON.stringify(results) === JSON.stringify(['PHOTO_IN_USE', 'saved']) ||
        JSON.stringify(results) ===
          JSON.stringify(['PHOTO_NOT_FOUND', 'saved']),
      JSON.stringify(results),
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from external_item_requests r join external_item_photos p on p.id=any(r.photos) where r.owner_id=$1 and p.discarded_at is not null',
          [owner],
        )
      ).rows[0].n,
      0,
    )

    const unsubmitted = (
      await setup.query(
        'select count(*)::int n from external_item_photos p where owner_id=$1 and not exists(select 1 from external_item_requests r where r.photos @> array[p.id])',
        [owner],
      )
    ).rows[0].n
    for (let i = unsubmitted; i < 79; i++)
      await a.query(
        "select reserve_external_item_photo($1,repeat('c',64),100)",
        [randomUUID()],
      )
    assert.deepEqual(
      await together(() => [
        outcome(
          a.query("select reserve_external_item_photo($1,repeat('d',64),100)", [
            randomUUID(),
          ]),
        ),
        outcome(
          b.query("select reserve_external_item_photo($1,repeat('e',64),100)", [
            randomUUID(),
          ]),
        ),
      ]),
      ['PHOTO_LIMIT', 'saved'],
    )
    console.log(
      'PASS: central requests serialize host pause, capacity, replay, photo discard and upload quota across independent connections.',
    )
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
    await setup.query(
      'update platform_settings set central_app_tenant_id=$1,central_app_revision=$2 where only_row',
      [previous.central_app_tenant_id, previous.central_app_revision],
    )
  }
}
