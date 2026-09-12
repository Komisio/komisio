import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Called only by the loopback-only real MCP harness, using its isolated fixture user.
export async function testInspectionMCP({
  connect,
  rpc,
  db,
  tenant,
  seller,
  token,
  receptionClient,
}) {
  const bag = randomUUID(),
    otherBag = randomUUID()
  for (const id of [
    bag,
    otherBag,
    ...Array.from({ length: 21 }, () => randomUUID()),
  ])
    await rpc('receive_bag', {
      p_tenant: tenant,
      p_id: id,
      p_seller: seller,
      p_note: 'PRIVATE BAG NOTE',
    })
  const ids = Array.from({ length: 23 }, () => randomUUID()).sort()
  for (const [index, id] of ids.entries())
    await rpc('save_inspection_draft', {
      p_tenant: tenant,
      p_request: randomUUID(),
      p_bag: bag,
      p_draft: id,
      p_expected: 0,
      p_description: `Draft ${index}`,
      p_category: 'Garment',
      p_condition: 'Needs inspection',
    })
  const draft = ids[0]
  for (let version = 2; version <= 23; version++)
    await rpc('save_inspection_draft', {
      p_tenant: tenant,
      p_request: randomUUID(),
      p_bag: bag,
      p_draft: draft,
      p_expected: version - 1,
      p_description: `Version ${version}`,
      p_category: 'Garment',
      p_condition: 'Unverified',
    })
  await rpc('set_inspection_archived', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_bag: bag,
    p_draft: draft,
    p_expected: 23,
    p_archived: true,
    p_reason: 'Fixture archive',
  })
  const client = await connect('inspection:read')
  const tools = (await client.listTools()).tools
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      'komisio_read_inspection_operation',
      'komisio_list_bags',
      'komisio_read_inspection',
    ],
  )
  assert.equal(tools[0].annotations.readOnlyHint, true)
  assert.equal(tools[0].inputSchema.additionalProperties, false)
  async function list(args = {}) {
    const r = await client.callTool({
      name: 'komisio_list_bags',
      arguments: args,
    })
    assert(!r.isError, JSON.stringify(r.content))
    return r.structuredContent
  }
  const knownBags = (
    await db.query(
      'select id,reference from bag_receipts where tenant_id=$1 order by reference desc',
      [tenant],
    )
  ).rows
  const page1 = await list()
  assert.equal(page1.items.length, 20)
  assert.deepEqual(
    page1.items.map((x) => x.bagId),
    knownBags.slice(0, 20).map((x) => x.id),
  )
  assert.equal(page1.newer, null)
  assert.equal(page1.availableForSale, false)
  assert.equal(page1.evidenceIsUntrusted, true)
  for (const row of page1.items)
    assert.deepEqual(Object.keys(row).sort(), [
      'bagId',
      'receivedAt',
      'reference',
    ])
  assert(!JSON.stringify(page1).includes('PRIVATE BAG NOTE'))
  const page2 = await list({ older: page1.older })
  assert.deepEqual(
    page2.items.map((x) => x.bagId),
    knownBags.slice(20).map((x) => x.id),
  )
  assert.equal(page2.older, null)
  assert.deepEqual((await list({ newer: page2.newer })).items, page1.items)
  const bagRef = String(knownBags.find((x) => x.id === bag).reference)
  const lookup = await list({ bag: `K-${bagRef}` })
  assert.equal(lookup.items.length, 1)
  assert.equal(lookup.items[0].bagId, bag)
  assert.equal(lookup.items[0].reference, `K-${bagRef}`)
  assert.equal(
    (await list({ bag: String(Number.MAX_SAFE_INTEGER) })).items.length,
    0,
  )
  for (const args of [
    { seller },
    { tenantId: tenant },
    { limit: 500 },
    { bag: 'id.gt.0' },
    { bag: '9007199254740992' },
    { older: '0' },
    { older: '2', newer: '3' },
  ])
    assert(
      (await client.callTool({ name: 'komisio_list_bags', arguments: args }))
        .isError,
      JSON.stringify(args),
    )
  await assert.rejects(
    receptionClient.callTool({ name: 'komisio_list_bags', arguments: {} }),
    /not found/,
  )
  async function read(args) {
    const r = await client.callTool({
      name: 'komisio_read_inspection',
      arguments: { bagId: bag, ...args },
    })
    assert(!r.isError, JSON.stringify(r.content))
    return r.structuredContent
  }
  const first = await read({ status: 'all', draft, version: 1 })
  assert.equal(first.items.length, 20)
  assert.equal(first.past.length, 20)
  assert.equal(first.historical.description, 'Draft 0')
  assert.equal(first.historical.archived, false)
  assert.equal(first.selected.revision, 24)
  assert.equal(first.selected.archived, true)
  assert.equal(first.selected.change_reason, 'Fixture archive')
  assert.equal(first.nextHistoryBefore, 5)
  assert.equal(first.nextAfter, ids[19])
  assert.equal(first.availableForSale, false)
  assert.equal(first.evidenceIsUntrusted, true)
  assert.equal(first.bag.note, undefined)
  assert(!JSON.stringify(first).includes('PRIVATE BAG NOTE'))
  const second = await read({ status: 'all', after: first.nextAfter })
  assert.deepEqual(
    second.items.map((x) => x.draft_id),
    ids.slice(20),
  )
  assert.equal(second.nextAfter, null)
  const previous = await read({ status: 'all', before: second.nextBefore })
  assert.deepEqual(
    previous.items.map((x) => x.draft_id),
    ids.slice(0, 20),
  )
  const older = await read({ draft, historyBefore: first.nextHistoryBefore })
  assert.deepEqual(
    older.past.map((x) => x.revision),
    [4, 3, 2, 1],
  )
  assert.equal(older.nextHistoryBefore, null)
  const archived = await read({ status: 'archived' })
  assert.deepEqual(
    archived.items.map((x) => x.draft_id),
    [draft],
  )
  assert(!(await read({})).items.some((x) => x.draft_id === draft))
  for (const args of [
    { bagId: randomUUID() },
    { bagId: otherBag, draft },
    { bagId: bag, draft: randomUUID() },
    { bagId: bag, draft, version: 25 },
    { bagId: bag, version: 1 },
    { bagId: bag, historyBefore: 2 },
    { bagId: bag, after: ids[0], before: ids[1] },
    { bagId: bag, tenantId: tenant },
    { bagId: bag, limit: 1000 },
  ])
    assert(
      (
        await client.callTool({
          name: 'komisio_read_inspection',
          arguments: args,
        })
      ).isError,
      JSON.stringify(args),
    )
  for (const denied of [
    await connect('inspection:read', 'invalid-token'),
    await connect('inspection:read', token, randomUUID()),
  ]) {
    assert(
      (await denied.callTool({ name: 'komisio_list_bags', arguments: {} }))
        .isError,
    )
    assert(
      (
        await denied.callTool({
          name: 'komisio_read_inspection',
          arguments: { bagId: bag },
        })
      ).isError,
    )
  }
  await assert.rejects(
    receptionClient.callTool({
      name: 'komisio_read_inspection',
      arguments: { bagId: bag },
    }),
    /not found/,
  )
  const previewer = await connect('inspection:preview')
  assert.deepEqual(
    (await previewer.listTools()).tools.map((t) => t.name),
    ['komisio_prepare_inspection_reception', 'komisio_preview_inspection'],
  )
  const candidate = {
    bagId: bag,
    draftId: ids[1],
    expectedRevision: 1,
    suggestions: { description: 'Proposed description', category: '' },
  }
  async function preview(args = candidate) {
    return previewer.callTool({
      name: 'komisio_preview_inspection',
      arguments: args,
    })
  }
  const proposed = await preview()
  assert(!proposed.isError, JSON.stringify(proposed.content))
  const output = proposed.structuredContent
  assert.equal(output.baseRevision, 1)
  for (const key of ['persisted', 'staged', 'approved', 'availableForSale'])
    assert.equal(output[key], false)
  assert.equal(output.before.description, 'Draft 1')
  assert.equal(output.after.description, 'Proposed description')
  assert.equal(output.after.category, '')
  assert.equal(output.after.condition, 'Needs inspection')
  assert.deepEqual(
    output.changes.map((x) => x.field),
    ['description', 'category'],
  )
  assert.equal(output.revision, undefined)
  assert.equal(output.bag, undefined)
  assert.equal(output.history, undefined)
  assert(!JSON.stringify(output).includes('PRIVATE BAG NOTE'))
  const noop = await preview({
    ...candidate,
    suggestions: { description: 'Draft 1' },
  })
  assert(!noop.isError)
  assert.deepEqual(noop.structuredContent.changes, [])
  for (const args of [
    { ...candidate, draftId: draft, expectedRevision: 24 },
    { ...candidate, expectedRevision: 2 },
    { ...candidate, bagId: otherBag },
    { ...candidate, draftId: randomUUID() },
    { ...candidate, tenantId: tenant },
    { ...candidate, approved: true },
    { ...candidate, suggestions: {} },
    { ...candidate, suggestions: { description: '   ' } },
    { ...candidate, suggestions: { price: '100.00' } },
    { ...candidate, suggestions: { description: 'x'.repeat(1001) } },
  ])
    assert((await preview(args)).isError, JSON.stringify(args))
  await assert.rejects(
    client.callTool({
      name: 'komisio_preview_inspection',
      arguments: candidate,
    }),
    /not found/,
  )
  await assert.rejects(
    previewer.callTool({
      name: 'komisio_read_inspection',
      arguments: { bagId: bag },
    }),
    /not found/,
  )
  for (const denied of [
    await connect('inspection:preview', 'invalid-token'),
    await connect('inspection:preview', token, randomUUID()),
  ])
    assert(
      (
        await denied.callTool({
          name: 'komisio_preview_inspection',
          arguments: candidate,
        })
      ).isError,
    )
  const preparationInput = { bagId: bag, draftId: ids[1], expectedRevision: 1 }
  const prepare = (args = preparationInput) =>
    previewer.callTool({
      name: 'komisio_prepare_inspection_reception',
      arguments: args,
    })
  const preparation = await prepare()
  assert(!preparation.isError, JSON.stringify(preparation.content))
  assert.equal(preparation.structuredContent.origin.revision, 1)
  assert.equal(preparation.structuredContent.candidates[0].value, 'Draft 1')
  assert.equal(preparation.structuredContent.readyToPublish, false)
  assert.equal(preparation.structuredContent.otherRecordsChecked, false)
  for (const key of ['persisted', 'staged', 'approved', 'availableForSale'])
    assert.equal(preparation.structuredContent[key], false)
  for (const text of [
    'PRIVATE BAG NOTE',
    'sourceIds',
    'sellerId',
    'agreementId',
    'suggestions',
  ])
    assert(!JSON.stringify(preparation.structuredContent).includes(text))
  for (const args of [
    { ...preparationInput, expectedRevision: 2 },
    { ...preparationInput, draftId: draft, expectedRevision: 24 },
    { ...preparationInput, bagId: otherBag },
    { ...preparationInput, draftId: randomUUID() },
    { ...preparationInput, tenantId: tenant },
    { ...preparationInput, sourceIds: [randomUUID()] },
    { ...preparationInput, expectedRevision: 0 },
    { ...preparationInput, approved: true },
    { ...preparationInput, fields: { description: 'Unsaved replacement' } },
  ])
    assert((await prepare(args)).isError, JSON.stringify(args))
  await assert.rejects(
    client.callTool({
      name: 'komisio_prepare_inspection_reception',
      arguments: preparationInput,
    }),
    /not found/,
  )
  for (const denied of [
    await connect('inspection:preview', 'invalid-token'),
    await connect('inspection:preview', token, randomUUID()),
  ])
    assert(
      (
        await denied.callTool({
          name: 'komisio_prepare_inspection_reception',
          arguments: preparationInput,
        })
      ).isError,
    )
  const unchanged = (
    await db.query(
      'select revision,description,category from inspection_current where draft_id=$1',
      [ids[1]],
    )
  ).rows[0]
  assert.deepEqual(unchanged, {
    revision: 1,
    description: 'Draft 1',
    category: 'Garment',
  })
  // A real staff edit invalidates the old base, even though no preview was saved.
  await rpc('save_inspection_draft', {
    p_tenant: tenant,
    p_request: randomUUID(),
    p_bag: bag,
    p_draft: ids[1],
    p_expected: 1,
    p_description: 'Staff edited',
    p_category: 'Garment',
    p_condition: 'Needs inspection',
  })
  assert((await prepare()).isError)
  assert(!(await prepare({ ...preparationInput, expectedRevision: 2 })).isError)
  assert((await preview()).isError)
  assert(!(await preview({ ...candidate, expectedRevision: 2 })).isError)
  const stager = await connect('inspection:propose')
  const op = randomUUID(),
    rejectedOp = randomUUID()
  const command = {
    requestId: op,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    bagId: bag,
    draftId: ids[2],
    expectedRevision: 1,
    fields: {
      description: 'Staged inspection description',
      category: 'Garment',
      condition: 'Good',
    },
  }
  const propose = (args) =>
    stager.callTool({
      name: 'komisio_propose_inspection_edit',
      arguments: args,
    })
  const staged = await propose(command)
  assert(!staged.isError, JSON.stringify(staged.content))
  assert.equal(staged.structuredContent.staged, true)
  assert.equal(staged.structuredContent.executed, false)
  assert(!(await propose(command)).isError)
  assert(!(await propose({ ...command, requestId: rejectedOp })).isError)
  const detail = await client.callTool({
    name: 'komisio_read_inspection_operation',
    arguments: { operationId: op },
  })
  assert(!detail.isError, JSON.stringify(detail.content))
  assert.equal(detail.structuredContent.context.before.description, 'Draft 2')
  assert.equal(
    detail.structuredContent.context.after.description,
    command.fields.description,
  )
  assert.equal(detail.structuredContent.context.kind, 'inspection')
  assert.equal(detail.structuredContent.context.canApprove, true)
  assert(
    (
      await receptionClient.callTool({
        name: 'komisio_read_reception_operation',
        arguments: { operationId: op },
      })
    ).isError,
  )
  assert.equal(
    (
      await db.query(
        'select revision from inspection_current where draft_id=$1',
        [ids[2]],
      )
    ).rows[0].revision,
    1,
  )
  for (const args of [
    { ...command, fields: { ...command.fields, price: '20.00' } },
    { ...command, requestId: randomUUID(), expectedRevision: 0 },
    { ...command, fields: { ...command.fields, description: 'Changed retry' } },
    { ...command, expiresAt: new Date(Date.now() + 7200000).toISOString() },
    {
      ...command,
      requestId: randomUUID(),
      fields: {
        description: 'Draft 2',
        category: 'Garment',
        condition: 'Needs inspection',
      },
    },
  ])
    assert((await propose(args)).isError)
  await assert.rejects(
    client.callTool({
      name: 'komisio_propose_inspection_edit',
      arguments: command,
    }),
    /not found/,
  )
  await rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: op,
    p_decision: 'approved',
    p_reason: 'Fixture staff review',
  })
  await rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: rejectedOp,
    p_decision: 'rejected',
    p_reason: 'Fixture rejection',
  })
  assert(!(await propose(command)).isError) // Lost proposal response still replays after execution.
  const saved = (
    await db.query(
      'select id,revision,description,created_by from inspection_current where draft_id=$1',
      [ids[2]],
    )
  ).rows[0]
  assert.equal(saved.id, op)
  assert.equal(saved.revision, 2)
  assert.equal(saved.description, command.fields.description)
  assert.equal(saved.created_by, staged.structuredContent.actor)
  const historical = await client.callTool({
    name: 'komisio_read_inspection_operation',
    arguments: { operationId: op },
  })
  assert.equal(
    historical.structuredContent.context.before.description,
    'Draft 2',
  )
  assert.equal(historical.structuredContent.operation.outcome, 'executed')
  const counts = await db.query(
    'select count(*)::int n from inspection_draft_revisions where bag_id=$1',
    [bag],
  )
  assert.equal(counts.rows[0].n, 48)
  return {
    client,
    bag,
    previewer,
    preparationInput: { ...preparationInput, expectedRevision: 2 },
    stager,
    stagedInput: command,
    previewInput: { ...candidate, expectedRevision: 2 },
  }
}
