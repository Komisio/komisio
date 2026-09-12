import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Only called by the loopback-only MCP harness; data are synthetic read fixtures.
export async function testOperationDiscovery({ connect, rpc, db, uid, token }) {
  const tenant = await rpc('create_tenant', {
    p_name: 'Operation discovery fixture',
    p_slug: `discovery-${randomUUID()}`,
    p_request_id: randomUUID(),
  })
  const inspectionPayload = {
    bagId: randomUUID(),
    draftId: randomUUID(),
    expectedRevision: 1,
    fields: {
      description: 'PRIVATE descriptive payload',
      category: '',
      condition: '',
    },
  }
  const receptionPayload = {
    sessionId: randomUUID(),
    sourceRevision: 1,
    previousReviewId: null,
    agreementId: randomUUID(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    suggestions: {
      metadata: {
        description: {
          value: 'PRIVATE reception payload',
          sourceIds: [randomUUID()],
          certainty: 'observed',
        },
      },
      price: {
        currency: 'SEK',
        amount: '100.00',
        rationale: 'PRIVATE appraisal',
        sourceIds: [randomUUID()],
      },
      questions: [],
    },
  }
  for (const [kind, payload, count, base] of [
    [
      'saveInspectionDraft',
      inspectionPayload,
      55,
      '2026-09-01T12:00:00.123456Z',
    ],
    [
      'publishReceptionReview',
      receptionPayload,
      60,
      '2026-09-02T12:00:00.123456Z',
    ],
  ])
    await db.query(
      `insert into pending_operations(id,tenant_id,kind,risk_level,payload,actor_kind,actor_label,proposed_by,expires_at,created_at)
    select gen_random_uuid(),$1,$2,'low',$3::jsonb,'agent','PRIVATE actor label',$4,
    case when g=1 then now()-interval '1 hour' else now()+interval '1 day' end,
    $5::timestamptz+(g/5)*interval '1 microsecond' from generate_series(1,$6::int) g`,
      [tenant, kind, JSON.stringify(payload), uid, base, count],
    )
  const summaries = []
  for (const [scope, name, kind, count] of [
    [
      'inspection:read',
      'komisio_list_inspection_operations',
      'saveInspectionDraft',
      55,
    ],
    [
      'reception:read',
      'komisio_list_reception_operations',
      'publishReceptionReview',
      60,
    ],
  ]) {
    const client = await connect(scope, token, tenant)
    summaries.push({ client, name })
    const catalog = await client.listTools()
    assert(catalog.tools.find((t) => t.name === name)?.annotations.readOnlyHint)
    assert(
      !catalog.tools.some(
        (t) =>
          t.name ===
          (scope === 'reception:read'
            ? 'komisio_list_inspection_operations'
            : 'komisio_list_reception_operations'),
      ),
    )
    const ids = [],
      cursors = new Set()
    let cursor = {}
    for (let page = 0; page < 4; page++) {
      const result = await client.callTool({
        name,
        arguments: { status: 'all', ...cursor },
      })
      assert(!result.isError, JSON.stringify(result.content))
      const data = result.structuredContent
      assert.equal(data.readOnly, true)
      assert.equal(data.guidanceOnly, true)
      assert.equal(data.evidenceIsUntrusted, true)
      assert(data.items.length <= 20)
      for (const item of data.items) {
        assert.equal(item.kind, kind)
        assert.deepEqual(Object.keys(item).sort(), [
          'createdAt',
          'expiresAt',
          'kind',
          'operationId',
          'riskLevel',
          'status',
        ])
        ids.push(item.operationId)
      }
      const serialized = JSON.stringify(data)
      for (const secret of [
        'PRIVATE',
        uid,
        tenant,
        'payload',
        'reason',
        'proposed_by',
      ])
        assert(!serialized.includes(secret))
      if (!data.nextBefore) break
      assert.equal(data.nextBefore.beforeCreated, data.items.at(-1).createdAt)
      assert.equal(data.nextBefore.beforeId, data.items.at(-1).operationId)
      // Postgres may omit trailing zeroes; preserve the exact returned fraction.
      assert.match(data.nextBefore.beforeCreated, /\.\d{4,6}/)
      assert(!cursors.has(JSON.stringify(data.nextBefore)))
      cursors.add(JSON.stringify(data.nextBefore))
      cursor = data.nextBefore
    }
    assert.equal(ids.length, count)
    assert.equal(new Set(ids).size, count)
    const expired = await client.callTool({
      name,
      arguments: { status: 'expired' },
    })
    assert(!expired.isError)
    assert.equal(expired.structuredContent.items.length, 1)
    assert.equal(expired.structuredContent.items[0].status, 'expired')
    for (const args of [
      { kind },
      { tenantId: randomUUID() },
      { beforeId: randomUUID() },
      { status: 'approved' },
      { status: ['open'] },
    ])
      assert((await client.callTool({ name, arguments: args })).isError)
    const wrongTenant = await connect(scope, token, randomUUID())
    assert((await wrongTenant.callTool({ name, arguments: {} })).isError)
    const invalid = await connect(scope, 'invalid-token', tenant)
    assert((await invalid.callTool({ name, arguments: {} })).isError)
    const missing = await connect('reception:preview', token, tenant)
    await assert.rejects(missing.callTool({ name, arguments: {} }), /not found/)
  }
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from pending_operations where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    115,
  )
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from operation_decisions where tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    0,
  )
  return summaries
}
