import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'

// Uses the concurrency harness's own disposable database and authenticated sessions.
export async function raceInspectionApproval({ setup, sessions, tenant, bag }) {
  const draft = randomUUID(),
    operation = randomUUID()
  await sessions[0].c.query(
    "select save_inspection_draft($1,$2,$3,$4,0,'Original','','')",
    [tenant, randomUUID(), bag, draft],
  )
  await sessions[0].c.query(
    "select propose_operation($1,$2,'saveInspectionDraft',$3::jsonb,'race-agent',now()+interval '1 day')",
    [
      tenant,
      operation,
      JSON.stringify({
        bagId: bag,
        draftId: draft,
        expectedRevision: 1,
        fields: { description: 'Agent edit', category: '', condition: '' },
      }),
    ],
  )
  await setup.query('begin')
  await setup.query('select id from tenants where id=$1 for update', [tenant])
  const approval = sessions[0].c.query(
    "select decide_operation($1,$2,$3,'approved','')",
    [tenant, randomUUID(), operation],
  )
  const edit = sessions[1].c
    .query("select save_inspection_draft($1,$2,$3,$4,1,'Staff edit','','')", [
      tenant,
      randomUUID(),
      bag,
      draft,
    ])
    .then(
      () => 'saved',
      (e) => {
        if (e.message.includes('INSPECTION_DRAFT_CHANGED')) return 'stale'
        throw e
      },
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
  const [, edited] = await Promise.all([approval, edit])
  const state = (
    await setup.query(
      'select (select count(*)::int from inspection_draft_revisions where draft_id=$1) revisions,(select description from inspection_current where draft_id=$1) description,(select outcome from operation_decisions where operation_id=$2) outcome',
      [draft, operation],
    )
  ).rows[0]
  if (
    waiting !== 2 ||
    state.revisions !== 2 ||
    !(
      (edited === 'saved' &&
        state.description === 'Staff edit' &&
        state.outcome === 'failed') ||
      (edited === 'stale' &&
        state.description === 'Agent edit' &&
        state.outcome === 'executed')
    )
  )
    throw Error(
      `Inspection approval/edit serialization failed: ${JSON.stringify({ waiting, edited, state })}`,
    )
  console.log(
    'PASS: inspection approval and a staff edit serialize; only one exact-base revision is saved.',
  )
}
