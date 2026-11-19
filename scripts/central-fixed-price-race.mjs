import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'

export async function raceCentralFixedPrice({ setup, connectionString }) {
  const staff = randomUUID(),
    seller = randomUUID(),
    agreement = randomUUID(),
    photo = randomUUID(),
    request = randomUUID(),
    command = randomUUID()
  const previous = (
    await setup.query('select central_app_tenant_id from platform_settings')
  ).rows[0].central_app_tenant_id
  const runtime = (
    await setup.query('select * from komisio_private.central_shipping_runtime')
  ).rows[0]
  const clients = [0, 1].map(() => new pg.Client({ connectionString }))
  const capability = '8'.repeat(64)
  const recipient = {
    name: 'Synthetic company',
    street: 'Test 1',
    postalCode: '12345',
    city: 'Teststad',
    country: 'SE',
    phone: '+46700000000',
    email: 'synthetic@example.test',
  }
  try {
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',
      [
        staff,
        `staff-${staff}@example.test`,
        seller,
        `seller-${seller}@example.test`,
      ],
    )
    await setup.query('set role authenticated')
    await setup.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: staff, role: 'authenticated' }),
    ])
    const tenant = (
      await setup.query('select create_tenant($1,$2,$3) id', [
        'Synthetic fixed race',
        `fixed-${command}`,
        randomUUID(),
      ])
    ).rows[0].id
    await setup.query(
      "select publish_seller_agreement($1,$2,null,'Synthetic terms','Synthetic terms','sv',true)",
      [tenant, agreement],
    )
    await setup.query('reset role')
    await setup.query('update platform_settings set central_app_tenant_id=$1', [
      tenant,
    ])
    await setup.query(
      "insert into komisio_private.central_shipping_runtime(singleton,key_hash,tenant_id,environment,recipient,service_code) values(true,$1,$2,'sandbox',$3,'11') on conflict(singleton) do update set key_hash=excluded.key_hash,tenant_id=excluded.tenant_id,environment=excluded.environment,recipient=excluded.recipient,service_code=excluded.service_code",
      [
        createHash('sha256').update(capability).digest('hex'),
        tenant,
        recipient,
      ],
    )
    await setup.query('set role authenticated')
    await setup.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: seller, role: 'authenticated' }),
    ])
    await setup.query(
      'select save_central_intake_profile($1,$2,$3,-1,$4,$5,true)',
      [
        randomUUID(),
        tenant,
        agreement,
        { street: 'Test 2', postalCode: '12345', city: 'Teststad' },
        { firstName: 'Synthetic', lastName: 'Seller', phone: '+46700000001' },
      ],
    )
    await setup.query('select reserve_external_item_photo($1,$2,100)', [
      photo,
      'b'.repeat(64),
    ])
    await setup.query(
      "insert into storage.objects(bucket_id,name) values('external-item-photos',$1)",
      [`${seller}/${photo}.jpg`],
    )
    await setup.query(
      "select submit_central_item_request($1,$2,'Dress','','good','',60000,'SEK',$3,'SE','seller_amount',$4,'direct_purchase')",
      [request, tenant, [photo], agreement],
    )
    await setup.query('reset role')
    await Promise.all(
      clients.map(async (c) => {
        await c.connect()
        await c.query('set role authenticated')
        await c.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({ sub: staff, role: 'authenticated' }),
        ])
        await c.query("select set_config('request.headers',$1,false)", [
          JSON.stringify({ 'x-komisio-shipping': capability }),
        ])
      }),
    )
    const args = [
      command,
      tenant,
      seller,
      JSON.stringify([{ requestId: request, expectedSalePriceOre: '100000' }]),
    ]
    const results = await Promise.all(
      clients.map((c) =>
        c.query(
          "select review_central_item_group($1,$2,$3,$4,true,1,'sandbox') result",
          args,
        ),
      ),
    )
    assert.deepEqual(results.map((r) => r.rows[0].result.dispatch).sort(), [
      false,
      true,
    ])
    assert.equal(
      (
        await setup.query(
          'select count(*)::integer n from central_parcel_items where parcel_id=$1',
          [command],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::integer n from external_item_offers where request_id=$1',
          [request],
        )
      ).rows[0].n,
      1,
    )
    await assert.rejects(
      clients[0].query(
        "select review_central_item_group($1,$2,$3,$4,true,1,'sandbox')",
        [randomUUID(), ...args.slice(1)],
      ),
      /PARCEL_EXISTS/,
    )
    await clients[0].query(
      "select receive_handover($1,$2,l.handover_id,'staff_receipt','') from external_item_handover_links l join external_item_offers o on o.id=l.offer_id where o.request_id=$3",
      [tenant, randomUUID(), request],
    )
    const inspect = (client, id) =>
      client.query(
        'select inspect_central_direct_purchase($1,$2,$3,false) id',
        [tenant, request, id],
      )
    const attempts = await Promise.allSettled(
      clients.map((c) => inspect(c, randomUUID())),
    )
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1)
    const loser = attempts.find((a) => a.status === 'rejected')
    assert.match(loser.reason.message, /REQUEST_CONFLICT/)
    const posted = await setup.query(
      'select l.amount_ore::text amount,p.command_id from komisio_private.central_direct_purchases p join seller_ledger_entries l on l.id=p.ledger_id where p.request_id=$1',
      [request],
    )
    assert.equal(posted.rowCount, 1)
    assert.equal(posted.rows[0].amount, '60000')
    await Promise.all(clients.map((c) => inspect(c, posted.rows[0].command_id)))
    console.log(
      'central fixed-price race: one acceptance, parcel, dispatch, purchase and credit',
    )
  } finally {
    await setup.query('reset role')
    await setup.query('update platform_settings set central_app_tenant_id=$1', [
      previous,
    ])
    if (runtime)
      await setup.query(
        'update komisio_private.central_shipping_runtime set key_hash=$1,tenant_id=$2,environment=$3,recipient=$4,service_code=$5',
        [
          runtime.key_hash,
          runtime.tenant_id,
          runtime.environment,
          runtime.recipient,
          runtime.service_code,
        ],
      )
    else
      await setup.query('delete from komisio_private.central_shipping_runtime')
    await Promise.all(clients.map((c) => c.end()))
  }
}
