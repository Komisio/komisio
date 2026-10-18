import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceStoreMail({ setup, sessions, tenant }) {
  const [owner, other] = sessions
  const seller = randomUUID(),
    consent = randomUUID(),
    send = randomUUID()
  const email = (
    await setup.query('select email from auth.users where id=$1', [other.uid])
  ).rows[0].email
  await owner.c.query('select register_seller($1,$2,$3,$4,$5)', [
    tenant,
    seller,
    'Synthetic mail seller',
    email,
    '',
  ])
  await other.c.query('select set_store_mail_consent($1,$2,$3,null,true)', [
    tenant,
    seller,
    consent,
  ])
  const profile = {
    address: { street: '', postalCode: '', city: '' },
    contact: { email: 'store@example.test', phone: '', website: '' },
    openingHours: [],
    accepts: '',
    concept: '',
    language: 'en',
  }
  const previous = (
    await owner.c.query('select current_store_profile($1) p', [tenant])
  ).rows[0].p.id
  await owner.c.query('select publish_store_profile($1,$2,$3,$4)', [
    tenant,
    randomUUID(),
    previous,
    profile,
  ])
  const preview = (
    await owner.c.query('select preview_store_mail($1) p', [tenant])
  ).rows[0].p
  await owner.c.query('select create_store_mail($1,$2,$3,$4,$5)', [
    tenant,
    send,
    'Synthetic message',
    'Synthetic content',
    preview.revision,
  ])
  const token = 'a'.repeat(64),
    hash = createHash('sha256').update(token).digest('hex')
  await setup.query('begin')
  await setup.query('select 1 from tenants where id=$1 for update', [tenant])
  const claims = sessions.map(({ c }) =>
    c.query('select claim_store_mail($1,$2,$3,$4) r', [
      tenant,
      send,
      randomUUID(),
      hash,
    ]),
  )
  await pause(100)
  await setup.query('commit')
  const results = (await Promise.all(claims)).map((r) => r.rows[0].r)
  assert.equal(results.filter((r) => r.messageId).length, 1)
  const message = results.find((r) => r.messageId).messageId
  assert.equal(
    (
      await setup.query(
        'select count(*)::int n from seller_communications where store_mail_id=$1',
        [send],
      )
    ).rows[0].n,
    1,
  )
  await pause(1100)
  assert.equal(
    (
      await owner.c.query('select claim_store_mail($1,$2,$3,$4) r', [
        tenant,
        send,
        randomUUID(),
        hash,
      ])
    ).rows[0].r.done,
    true,
  )
  // Both a browser save and a link withdrawal serialize on the same tenant.
  await owner.c.query('select unsubscribe_store_mail($1,$2)', [message, token])
  await assert.rejects(
    other.c.query('select set_store_mail_consent($1,$2,$3,$4,true)', [
      tenant,
      seller,
      randomUUID(),
      consent,
    ]),
    /CONSENT_CHANGED/,
  )
  assert.equal(
    (
      await other.c.query('select my_store_mail_consent($1,$2) r', [
        tenant,
        seller,
      ])
    ).rows[0].r.enabled,
    false,
  )
  console.log(
    'PASS: competing bulk dispatches claim a recipient once; withdrawal prevents stale re-enrollment.',
  )
}
