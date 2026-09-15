import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Called only by the loopback-only real MCP harness, using its isolated fixture user.
// Stages acceptance over stdio, proves the proposer cannot approve, and approves
// as a second store member through the authenticated database boundary.
export async function testItemsMCP({ connect, rpc, db, tenant, token, uid }) {
  const purchase = randomUUID()
  await rpc('register_purchase', {
    p_tenant: tenant,
    p_id: purchase,
    p_note: 'PRIVATE PURCHASE NOTE',
    p_price_ore: 15000,
    p_evidence: 'MCP fixture receipt',
    p_margin_eligible: false,
  })
  const stager = await connect('items:propose')
  assert.deepEqual(
    (await stager.listTools()).tools.map((t) => t.name),
    ['komisio_propose_acceptance'],
  )
  const op = randomUUID()
  const command = {
    requestId: op,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    originKind: 'purchase',
    originId: purchase,
    originRevision: null,
    priceOre: 25000,
  }
  const propose = (args) =>
    stager.callTool({ name: 'komisio_propose_acceptance', arguments: args })
  const staged = await propose(command)
  assert(!staged.isError, JSON.stringify(staged.content))
  assert.equal(staged.structuredContent.staged, true)
  assert.equal(staged.structuredContent.executed, false)
  assert.equal(staged.structuredContent.riskLevel, 'medium')
  assert.equal(staged.structuredContent.requiresDifferentApprover, true)
  assert.equal(staged.structuredContent.availableForSale, false)
  assert(!JSON.stringify(staged.structuredContent).includes('PRIVATE'))
  assert(!(await propose(command)).isError) // exact replay
  for (const args of [
    { ...command, priceOre: 250 * 100 + 0.5 },
    { ...command, priceOre: '25000' },
    { ...command, originRevision: 1 },
    { ...command, priceOre: 26000 }, // same request, changed payload
    { ...command, tenantId: tenant },
    { ...command, requestId: randomUUID(), originId: randomUUID() },
  ]) {
    const r = await propose(args)
    assert(r.isError, JSON.stringify(args))
  }
  const pending = (
    await db.query(
      'select kind,risk_level,proposed_by,actor_label from pending_operations where id=$1',
      [op],
    )
  ).rows[0]
  assert.deepEqual(pending, {
    kind: 'acceptItem',
    risk_level: 'medium',
    proposed_by: uid,
    actor_label: 'komisio-mcp',
  })
  assert.equal(
    (await db.query('select count(*)::int n from items where id=$1', [op]))
      .rows[0].n,
    0,
  )
  // The proposing identity may not approve its own medium-risk proposal.
  await assert.rejects(
    rpc('decide_operation', {
      p_tenant: tenant,
      p_id: randomUUID(),
      p_operation: op,
      p_decision: 'approved',
      p_reason: 'Self approval must fail',
    }),
  )
  // A second store member approves through the authenticated database boundary.
  const approver = randomUUID()
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,aud,role,instance_id,created_at,updated_at) values($1,$2,now(),'authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now())",
    [approver, `mcp-approver-${approver}@example.test`],
  )
  await db.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
    [tenant, approver],
  )
  const decision = randomUUID()
  await db.query('begin')
  try {
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: approver, role: 'authenticated', aal: 'aal2' }),
    ])
    await db.query(
      "select decide_operation($1,$2,$3,'approved','MCP fixture approval')",
      [tenant, decision, op],
    )
    await db.query('commit')
  } catch (e) {
    await db.query('rollback')
    throw e
  }
  const outcome = (
    await db.query(
      'select outcome,result_id,decided_by from operation_decisions where id=$1',
      [decision],
    )
  ).rows[0]
  assert.deepEqual(outcome, {
    outcome: 'executed',
    result_id: op,
    decided_by: approver,
  })
  const item = (
    await db.query(
      'select accepted_by,ownership,origin_kind,(select price_ore from item_prices where item_id=items.id) price from items where id=$1',
      [op],
    )
  ).rows[0]
  assert.deepEqual(item, {
    accepted_by: approver,
    ownership: 'store',
    origin_kind: 'purchase',
    price: '25000',
  })
  assert(!(await propose(command)).isError) // lost response still replays after execution
  await assert.rejects(
    (await connect('reception:read')).callTool({
      name: 'komisio_propose_acceptance',
      arguments: command,
    }),
    /not found/,
  )
  for (const denied of [
    await connect('items:propose', 'invalid-token'),
    await connect('items:propose', token, randomUUID()),
  ])
    assert(
      (
        await denied.callTool({
          name: 'komisio_propose_acceptance',
          arguments: { ...command, requestId: randomUUID() },
        })
      ).isError,
    )
  // Read scopes: the accepted purchase is findable by its note, the summary
  // carries its price, and neither scope exposes the proposal tool.
  const reader = await connect('items:read,sales:read')
  assert.deepEqual((await reader.listTools()).tools.map((t) => t.name).sort(), [
    'komisio_find_items',
    'komisio_find_receipts',
    'komisio_read_item_summary',
    'komisio_read_receipt',
  ])
  const found = await reader.callTool({
    name: 'komisio_find_items',
    arguments: { query: 'purchase note', stage: 'on_sale' },
  })
  assert(!found.isError, JSON.stringify(found.content))
  const row = found.structuredContent.items.find((i) => i.id === op)
  assert(row, 'accepted purchase is found by its note')
  assert.equal(row.title, 'PRIVATE PURCHASE NOTE')
  assert.equal(row.currentPriceOre, 25000)
  assert.equal(row.stage, 'on_sale')
  assert.equal(found.structuredContent.readOnly, true)
  const summary = await reader.callTool({
    name: 'komisio_read_item_summary',
    arguments: { itemId: op },
  })
  assert(!summary.isError, JSON.stringify(summary.content))
  assert.equal(summary.structuredContent.item.originKind, 'purchase')
  assert.equal(summary.structuredContent.prices[0].priceOre, 25000)
  assert(
    (await reader.callTool({ name: 'komisio_find_receipts', arguments: {} }))
      .structuredContent.receipts !== undefined,
  )
  assert(
    (
      await reader.callTool({
        name: 'komisio_read_receipt',
        arguments: { saleId: randomUUID() },
      })
    ).isError,
  )
  for (const args of [
    { stage: 'listed' },
    { limit: 101 },
    { tenantId: tenant },
  ])
    assert(
      (await reader.callTool({ name: 'komisio_find_items', arguments: args }))
        .isError,
      JSON.stringify(args),
    )
  return { stager, purchase, operation: op }
}
