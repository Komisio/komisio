import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceExternalRequests({ setup, connectionString }) {
  const owner = randomUUID(),
    staff = randomUUID()
  let tenant, other
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
      "select submit_external_item_request($1,$2,'Jacket','','good','',10000,'SEK',$3) as id",
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
    ;[tenant, other] = stores
    await a.query("select reserve_external_item_photo($1,repeat('a',64),100)", [
      photo,
    ])
    await a.query(
      "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
      [path],
    )
    const original = randomUUID()
    await submit(a, original)
    for (let i = 0; i < 8; i++) await submit(a, randomUUID())
    assert.deepEqual(
      await together(() => [
        outcome(submit(a, randomUUID())),
        outcome(submit(b, randomUUID(), other)),
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
      'PASS: external requests serialize cross-store capacity, replay, photo discard and upload quota across independent connections.',
    )
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()))
  }
}
