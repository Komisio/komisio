import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'

export async function raceMarketingConsent({ setup, sessions }) {
  const uid = sessions[0].uid
  await sessions[1].c.query(
    "select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ sub: uid, role: 'authenticated' })],
  )
  try {
    await setup.query('begin')
    await setup.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      'marketing-consent:' + uid,
    ])
    const pending = sessions.map(({ c }) =>
      c.query('select set_marketing_consent(true)'),
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
    await Promise.all(pending)
    assert.equal(waiting, 2)
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from marketing_consent_events where user_id=$1',
          [uid],
        )
      ).rows[0].n,
      1,
    )
    await sessions[0].c.query('select set_marketing_consent(false)')
    assert.equal(
      (await sessions[0].c.query('select my_marketing_consent() choice'))
        .rows[0].choice.consented,
      false,
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from marketing_consent_events where user_id=$1',
          [uid],
        )
      ).rows[0].n,
      2,
    )
    console.log(
      'PASS: concurrent consent saves serialize, deduplicate, and preserve later withdrawal.',
    )
  } finally {
    await sessions[1].c.query(
      "select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: sessions[1].uid, role: 'authenticated' })],
    )
  }
}
