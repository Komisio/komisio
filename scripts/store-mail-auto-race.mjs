import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceStoreMailAuto({ setup, connectionString }) {
  const owner = randomUUID()
  const clients = [
    new pg.Client({ connectionString }),
    new pg.Client({ connectionString }),
  ]
  const as = async (c, uid) => {
    await c.query('set role authenticated')
    await c.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: uid, role: 'authenticated' }),
    ])
  }
  try {
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    for (const c of clients) {
      await c.connect()
      await as(c, owner)
    }
    const tenant = (
      await clients[0].query(
        "select create_tenant('Synthetic auto race',$1,$2) id",
        [`auto-${owner}`, randomUUID()],
      )
    ).rows[0].id
    const agreement = randomUUID()
    await clients[0].query(
      "select publish_seller_agreement($1,$2,null,'Test','Synthetic terms','en',true)",
      [tenant, agreement],
    )
    await clients[0].query(
      "select set_seller_registration($1,$2,null,'enable')",
      [tenant, randomUUID()],
    )
    const token = (
      await clients[0].query('select seller_registration_settings($1) s', [
        tenant,
      ])
    ).rows[0].s.token
    let expected = null
    for (const disable of [true, false]) {
      const setting = randomUUID(),
        applicant = randomUUID(),
        application = randomUUID(),
        review = randomUUID()
      const prior = expected
      await clients[0].query('select set_store_mail_auto($1,$2,$3,true)', [
        tenant,
        setting,
        expected,
      ])
      expected = setting
      await setup.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [applicant, `${applicant}@example.test`],
      )
      await as(clients[1], applicant)
      await clients[1].query(
        "select submit_seller_registration($1,$2,'Synthetic seller','0700000000',$3,null,true,$4)",
        [token, application, agreement, setting],
      )
      await as(clients[1], owner)
      await clients[0].query('begin')
      if (disable) {
        expected = randomUUID()
        await clients[0].query('select set_store_mail_auto($1,$2,$3,false)', [
          tenant,
          expected,
          setting,
        ])
      } else
        await clients[0].query('select set_store_mail_auto($1,$2,$3,true)', [
          tenant,
          setting,
          prior,
        ])
      const pending = clients[1].query(
        'select review_seller_registration($1,$2,$3,true) id',
        [tenant, review, application],
      )
      await pause(100)
      if (!disable)
        await clients[0].query(
          'select review_seller_registration($1,$2,$3,true)',
          [tenant, review, application],
        )
      await clients[0].query('commit')
      const seller = (await pending).rows[0].id
      const count = (
        await setup.query(
          'select count(*)::int n from seller_store_mail_consents where seller_id=$1',
          [seller],
        )
      ).rows[0].n
      assert.equal(
        count,
        disable ? 0 : 1,
        disable
          ? 'committed disable wins over waiting approval'
          : 'concurrent retry creates one subscription',
      )
    }
    console.log(
      'PASS: automatic mail enrollment serializes with disabling and concurrent approval retries.',
    )
  } finally {
    await Promise.allSettled(
      clients.map(async (c) => {
        await c.query('rollback')
        await c.end()
      }),
    )
  }
}
