import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID, randomInt } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceExternalOffers({ setup, connectionString }) {
  const owner = randomUUID(),
    staff = randomUUID(),
    agreement = randomUUID(),
    photo = randomUUID()
  const run = randomUUID()
  const names = [0, 1].map((i) => `external_offer_race_${run}_${i}`)
  const clients = names.map(
    (application_name) => new pg.Client({ connectionString, application_name }),
  )
  const previous = (
    await setup.query(
      'select central_app_tenant_id from platform_settings where only_row',
    )
  ).rows[0].central_app_tenant_id
  const as = async (client, actor) => {
    await client.query('set role authenticated')
    await client.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: actor, role: 'authenticated' }),
    ])
  }
  const outcome = (promise) =>
    promise.then(
      () => 'saved',
      (e) => e.message,
    )
  async function together(start, tenant) {
    await setup.query('begin')
    if (tenant)
      await setup.query('select 1 from tenants where id=$1 for update', [
        tenant,
      ])
    else
      await setup.query('select komisio_private.lock_external_owner($1)', [
        owner,
      ])
    const promises = start()
    let waiting = 0
    try {
      for (let i = 0; i < 200; i++) {
        waiting = (
          await setup.query(
            "select count(*)::int n from pg_stat_activity where application_name=any($1) and wait_event_type='Lock'",
            [names],
          )
        ).rows[0].n
        if (waiting === 2) break
        await pause(10)
      }
    } finally {
      await setup.query('commit')
    }
    const results = await Promise.all(promises)
    assert.equal(
      waiting,
      2,
      'both commands must contend on the selected serialization lock',
    )
    return results.sort()
  }
  try {
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at) values($1,$2,now(),null,null),($3,null,null,$4,now())',
      [
        staff,
        `${staff}@example.test`,
        owner,
        `467${randomInt(100000000, 999999999)}`,
      ],
    )
    for (const c of clients) {
      await c.connect()
      await as(c, staff)
    }
    const tenant = (
      await clients[0].query('select create_tenant($1,$2,$3) id', [
        'Synthetic offer race',
        `offer-race-${run}`,
        randomUUID(),
      ])
    ).rows[0].id
    await clients[0].query(
      "select publish_seller_agreement($1,$2,null,'Synthetic terms','Synthetic offer race agreement','en',true)",
      [tenant, agreement],
    )
    await setup.query(
      'update platform_settings set central_app_tenant_id=$1 where only_row',
      [tenant],
    )
    await as(clients[0], owner)
    await clients[0].query(
      "select reserve_external_item_photo($1,repeat('a',64),100)",
      [photo],
    )
    await clients[0].query(
      "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
      [`${owner}/${photo}.jpg`],
    )
    const request = randomUUID()
    const submit = (id) =>
      clients[0].query(
        "select submit_external_item_request($1,$2,'Synthetic item','','good','',null,'SEK',$3,'SE')",
        [id, tenant, [photo]],
      )
    await submit(request)
    for (const c of clients) await as(c, staff)
    const issue = (c) =>
      c.query(
        'select issue_external_item_offer($1,$2,$3,null,40000,100000,$4)',
        [tenant, randomUUID(), request, agreement],
      )
    assert.deepEqual(
      await together(() => clients.map((c) => outcome(issue(c)))),
      ['REQUEST_CHANGED', 'saved'],
    )
    const offer = (
      await setup.query(
        'select id from external_item_offers where request_id=$1',
        [request],
      )
    ).rows[0].id
    for (const c of clients) await as(c, owner)
    assert.deepEqual(
      await together(() =>
        clients.map((c, i) =>
          outcome(
            c.query('select respond_external_item_offer($1,$2,$3,$4)', [
              randomUUID(),
              offer,
              i === 0,
              i === 0 ? agreement : null,
            ]),
          ),
        ),
      ),
      ['REQUEST_CHANGED', 'saved'],
    )
    const answer = (
      await setup.query(
        'select * from external_item_offer_responses where offer_id=$1',
        [offer],
      )
    ).rows
    assert.equal(answer.length, 1)
    const declined = (
      await setup.query(
        'select count(*)::int n from external_item_request_declines where request_id=$1',
        [request],
      )
    ).rows[0].n
    assert.equal(declined, answer[0].accepted ? 0 : 1)
    assert.deepEqual(
      await together(() =>
        clients.map((c) =>
          outcome(
            c.query('select respond_external_item_offer($1,$2,$3,$4)', [
              answer[0].id,
              offer,
              answer[0].accepted,
              answer[0].agreement_version_id,
            ]),
          ),
        ),
      ),
      ['saved', 'saved'],
    )

    // A request that started before expiry but waited on the lock is still late.
    const lateRequest = randomUUID(),
      lateOffer = randomUUID()
    await submit(lateRequest)
    await setup.query(
      "with t as (select clock_timestamp() n) insert into external_item_offers(id,tenant_id,request_id,owner_id,seller_amount_ore,expected_sale_price_ore,agreement_version_id,created_by,created_at,expires_at) select $1,$2,$3,$4,40000,100000,$5,$6,n-interval '48 hours'+interval '300 milliseconds',n+interval '300 milliseconds' from t",
      [lateOffer, tenant, lateRequest, owner, agreement, staff],
    )
    await setup.query('begin')
    await setup.query('select komisio_private.lock_external_owner($1)', [owner])
    const late = outcome(
      clients[0].query('select respond_external_item_offer($1,$2,true,$3)', [
        randomUUID(),
        lateOffer,
        agreement,
      ]),
    )
    await pause(500)
    await setup.query('commit')
    assert.equal(await late, 'OFFER_EXPIRED')
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from external_item_offer_responses where offer_id=$1',
          [lateOffer],
        )
      ).rows[0].n,
      0,
    )
    // Two final consents from separate app sessions share one explicit account
    // and one same-version handover, even when neither had an account yet.
    const completionOffers = []
    for (let i = 0; i < 2; i++) {
      const requestId = randomUUID(),
        offerId = randomUUID()
      await as(clients[0], owner)
      await submit(requestId)
      await as(clients[0], staff)
      await clients[0].query(
        'select issue_external_item_offer($1,$2,$3,null,40000,100000,$4)',
        [tenant, offerId, requestId, agreement],
      )
      completionOffers.push(offerId)
    }
    for (const c of clients) await as(c, owner)
    const commandIds = [randomUUID(), randomUUID()]
    const profile = {
      name: 'Synthetic phone owner',
      email: 'contact@example.test',
    }
    const bank = {
      holder: 'Synthetic phone owner',
      country: 'SE',
      kind: 'local',
      account: '123456789',
      routing: '8327',
    }
    const complete = (c, i) =>
      c.query('select complete_external_item_offer($1,$2,$3,$4,$5)', [
        commandIds[i],
        completionOffers[i],
        agreement,
        profile,
        bank,
      ])
    assert.deepEqual(
      await together(() => clients.map((c, i) => outcome(complete(c, i)))),
      ['saved', 'saved'],
    )
    const grouped = (
      await setup.query(
        'select count(distinct seller_id)::int sellers,count(distinct handover_id)::int handovers,count(*)::int links from external_item_handover_links where offer_id=any($1)',
        [completionOffers],
      )
    ).rows[0]
    assert.deepEqual(grouped, { sellers: 1, handovers: 1, links: 2 })
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_bank_versions where seller_id in(select seller_id from external_item_handover_links where offer_id=any($1))',
          [completionOffers],
        )
      ).rows[0].n,
      1,
    )
    assert.deepEqual(
      await together(() => clients.map((c) => outcome(complete(c, 0)))),
      ['saved', 'saved'],
    )
    assert.equal(
      await outcome(
        clients[0].query(
          'select complete_external_item_offer($1,$2,$3,null,null)',
          [randomUUID(), lateOffer, agreement],
        ),
      ),
      'OFFER_EXPIRED',
    )
    const handover = (
      await setup.query(
        'select handover_id from external_item_handover_links where offer_id=$1',
        [completionOffers[0]],
      )
    ).rows[0].handover_id
    const receipt = randomUUID()
    for (const c of clients) await as(c, staff)
    const receive = (c) =>
      c.query("select receive_handover($1,$2,$3,'staff_receipt','')", [
        tenant,
        receipt,
        handover,
      ])
    assert.deepEqual(
      await together(() => clients.map((c) => outcome(receive(c))), tenant),
      ['saved', 'saved'],
    )
    const guarantees = (
      await setup.query(
        "select count(*)::int n,count(distinct received_at)::int clocks,bool_and(due_at=received_at+interval '1080 hours') exact from external_item_guarantees where offer_id=any($1)",
        [completionOffers],
      )
    ).rows[0]
    assert.deepEqual(guarantees, { n: 2, clocks: 1, exact: true })
    const guarantee = (
      await setup.query(
        'select id from external_item_guarantees where offer_id=$1',
        [completionOffers[0]],
      )
    ).rows[0].id
    const prepared = (
      await clients[0].query(
        'select prepare_external_item_registration($1,$2) state',
        [tenant, guarantee],
      )
    ).rows[0].state
    for (const photoId of prepared.photoIds) {
      await setup.query(
        'insert into storage.objects(bucket_id,name) values($1,$3),($2,$3)',
        [
          'reception-photos',
          'seller-reception-photos',
          `${tenant}/${prepared.sessionId}/${photoId}.jpg`,
        ],
      )
    }
    const registrations = [randomUUID(), randomUUID()]
    const register = (c, id) =>
      c.query('select register_external_item($1,$2,$3,$4,30000)', [
        tenant,
        id,
        guarantee,
        'Synthetic guaranteed jacket',
      ])
    assert.deepEqual(
      await together(
        () => clients.map((c, i) => outcome(register(c, registrations[i]))),
        tenant,
      ),
      ['REQUEST_CHANGED', 'saved'],
    )
    const registered = (
      await setup.query(
        "select id,item_id from external_item_guarantee_events where guarantee_id=$1 and kind='registered'",
        [guarantee],
      )
    ).rows
    assert.equal(registered.length, 1)
    assert.deepEqual(
      await together(
        () => clients.map((c) => outcome(register(c, registered[0].id))),
        tenant,
      ),
      ['saved', 'saved'],
    )
    assert.equal(
      (
        await setup.query('select count(*)::int n from items where id=$1', [
          registered[0].item_id,
        ])
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: competing guaranteed registrations create one item; exact concurrent retries return the same item without credit',
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from seller_ledger_entries where tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      0,
    )
    console.log(
      'PASS: concurrent receipt retries freeze one guarantee per grouped item, one physical clock and no credit',
    )
    console.log(
      'PASS: concurrent first accounts, grouped handovers, exact onboarding retries and expired completion',
    )
    console.log(
      'PASS: competing offers, yes/no, exact retries and expiry after lock contention',
    )
  } finally {
    await setup.query('rollback').catch(() => {})
    await setup.query(
      'update platform_settings set central_app_tenant_id=$1 where only_row',
      [previous],
    )
    await Promise.all(clients.map((c) => c.end().catch(() => {})))
  }
}
