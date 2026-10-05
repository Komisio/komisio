import pg from 'pg'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function raceAgreementAssistance({ setup, connectionString }) {
  const uid = randomUUID(),
    id = randomUUID()
  await setup.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
    [uid, 'agreement-race@example.test'],
  )
  const clients = await Promise.all(
    [0, 1].map(async () => {
      const c = new pg.Client({ connectionString })
      await c.connect()
      await c.query('set role authenticated')
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: uid, role: 'authenticated' }),
      ])
      return c
    }),
  )
  try {
    const tenant = (
      await clients[0].query(
        "select create_tenant('Agreement race',$1,$2) id",
        ['agreement-' + id, id],
      )
    ).rows[0].id
    const results = await Promise.all(
      clients.map((c) =>
        c.query(
          "select begin_agreement_assistance($1,$2,null,'sv','fixture') result",
          [tenant, id],
        ),
      ),
    )
    assert.deepEqual(results.map((r) => r.rows[0].result.reserved).sort(), [
      false,
      true,
    ])
    const draft = { title: 'Fixture', body: 'Synthetic draft', questions: [] }
    await Promise.all(
      clients.map((c) =>
        c.query('select complete_agreement_assistance($1,$2,$3,10,5)', [
          tenant,
          id,
          draft,
        ]),
      ),
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from agreement_ai_results where id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from pending_operations where id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    )
    const decision = randomUUID()
    await Promise.all(
      clients.map((c) =>
        c.query("select decide_operation($1,$2,$3,'approved','')", [
          tenant,
          decision,
          id,
        ]),
      ),
    )
    assert.equal(
      (
        await setup.query(
          'select count(*)::int n from operation_decisions where operation_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    )
    console.log(
      'PASS: concurrent AI agreement requests reserve, complete and approve only once.',
    )
  } finally {
    await Promise.all(clients.map((c) => c.end()))
  }
}
