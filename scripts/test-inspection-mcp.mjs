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
  for (const id of [bag, otherBag])
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
    ['komisio_read_inspection'],
  )
  assert.equal(tools[0].annotations.readOnlyHint, true)
  assert.equal(tools[0].inputSchema.additionalProperties, false)
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
  const counts = await db.query(
    'select count(*)::int n from inspection_draft_revisions where bag_id=$1',
    [bag],
  )
  assert.equal(counts.rows[0].n, 46)
  return { client, bag }
}
