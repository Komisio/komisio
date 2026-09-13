import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Called only by the loopback-only real MCP harness. Stages the P2 kinds over
// stdio under their own scopes and proves the risk rules through the
// authenticated database boundary: a low-risk markdown batch executes for the
// proposer, a medium bulk update refuses self-approval, a high ledger
// adjustment stages without moving money, a return needs a real sale line.
export async function testProposalsMCP({
  connect,
  rpc,
  db,
  tenant,
  token,
  seller,
  item,
}) {
  const expiresAt = new Date(Date.now() + 3600000).toISOString()
  const lifecycle = await connect('lifecycle:propose')
  assert.deepEqual(
    (await lifecycle.listTools()).tools.map((t) => t.name).sort(),
    ['komisio_propose_bulk_item_update', 'komisio_propose_markdown_batch'],
  )
  // Not due yet: the batch is refused whole.
  const notDue = await lifecycle.callTool({
    name: 'komisio_propose_markdown_batch',
    arguments: {
      requestId: randomUUID(),
      expiresAt,
      items: [{ itemId: item, step: 1 }],
    },
  })
  assert(notDue.isError)
  // Fixture only: age the item past step one with the immutability trigger lifted.
  await db.query('alter table items disable trigger items_immutable')
  await db.query(
    "update items set accepted_at=accepted_at-interval '15 days' where id=$1",
    [item],
  )
  await db.query('alter table items enable trigger items_immutable')
  const batch = randomUUID()
  const staged = await lifecycle.callTool({
    name: 'komisio_propose_markdown_batch',
    arguments: {
      requestId: batch,
      expiresAt,
      items: [{ itemId: item, step: 1 }],
    },
  })
  assert(!staged.isError, JSON.stringify(staged.content))
  assert.equal(staged.structuredContent.riskLevel, 'low')
  assert.equal(staged.structuredContent.requiresDifferentApprover, false)
  assert.equal(staged.structuredContent.executed, false)
  const before = (
    await db.query(
      'select price_ore from item_prices where item_id=$1 order by seq desc limit 1',
      [item],
    )
  ).rows[0].price_ore
  assert.equal(before, '25000')
  await rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: batch,
    p_decision: 'approved',
    p_reason: 'Low risk: proposer approves',
  })
  const after = (
    await db.query(
      'select (select outcome from operation_decisions where operation_id=$1) outcome,(select price_ore from item_prices where item_id=$2 order by seq desc limit 1) price',
      [batch, item],
    )
  ).rows[0]
  assert.deepEqual(after, { outcome: 'executed', price: '22500' })
  // Bulk update at medium: staged, self-approval refused.
  const bulk = randomUUID()
  const bulkStaged = await lifecycle.callTool({
    name: 'komisio_propose_bulk_item_update',
    arguments: {
      requestId: bulk,
      expiresAt,
      update: {
        action: 'setPrice',
        reason: 'MCP fixture sale',
        items: [{ itemId: item, priceOre: 20000 }],
      },
    },
  })
  assert(!bulkStaged.isError, JSON.stringify(bulkStaged.content))
  assert.equal(bulkStaged.structuredContent.riskLevel, 'medium')
  assert.equal(bulkStaged.structuredContent.items, 1)
  await assert.rejects(
    rpc('decide_operation', {
      p_tenant: tenant,
      p_id: randomUUID(),
      p_operation: bulk,
      p_decision: 'approved',
      p_reason: 'Self approval must fail',
    }),
  )
  for (const args of [
    {
      requestId: randomUUID(),
      expiresAt,
      update: {
        action: 'setPrice',
        reason: '',
        items: [{ itemId: item, priceOre: 1 }],
      },
    },
    {
      requestId: randomUUID(),
      expiresAt,
      update: {
        action: 'endPeriod',
        endAction: 'burn',
        note: '',
        items: [{ itemId: item }],
      },
    },
    {
      requestId: randomUUID(),
      expiresAt,
      update: { action: 'setPrice', reason: 'x', items: [] },
    },
  ])
    assert(
      (
        await lifecycle.callTool({
          name: 'komisio_propose_bulk_item_update',
          arguments: args,
        })
      ).isError,
      JSON.stringify(args),
    )
  // Ledger adjustment at high: staged only.
  const ledger = await connect('ledger:propose')
  assert.deepEqual(
    (await ledger.listTools()).tools.map((t) => t.name),
    ['komisio_propose_ledger_adjustment'],
  )
  const adjustment = randomUUID()
  const adjustmentStaged = await ledger.callTool({
    name: 'komisio_propose_ledger_adjustment',
    arguments: {
      requestId: adjustment,
      expiresAt,
      sellerId: seller,
      amountOre: -500,
      reason: 'MCP fixture label fee',
    },
  })
  assert(!adjustmentStaged.isError, JSON.stringify(adjustmentStaged.content))
  assert.equal(adjustmentStaged.structuredContent.riskLevel, 'high')
  assert.equal(
    adjustmentStaged.structuredContent.executesOnlyForOwnerOrAdmin,
    true,
  )
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from seller_ledger_entries where seller_id=$1',
        [seller],
      )
    ).rows[0].n,
    0,
  )
  assert(
    (
      await ledger.callTool({
        name: 'komisio_propose_ledger_adjustment',
        arguments: {
          requestId: randomUUID(),
          expiresAt,
          sellerId: seller,
          amountOre: 0,
          reason: 'Nothing',
        },
      })
    ).isError,
  )
  // Return: needs a real completed sale line; an unknown line is refused.
  const sales = await connect('sales:propose')
  assert.deepEqual(
    (await sales.listTools()).tools.map((t) => t.name),
    ['komisio_propose_return'],
  )
  const missing = await sales.callTool({
    name: 'komisio_propose_return',
    arguments: {
      requestId: randomUUID(),
      expiresAt,
      saleLineId: randomUUID(),
      refundOre: 20000,
      reason: 'No such line',
    },
  })
  assert(missing.isError)
  assert(JSON.stringify(missing.content).includes('SALE_LINE_NOT_FOUND'))
  // Scope isolation: the lifecycle scope cannot stage a ledger adjustment.
  await assert.rejects(
    lifecycle.callTool({
      name: 'komisio_propose_ledger_adjustment',
      arguments: {
        requestId: randomUUID(),
        expiresAt,
        sellerId: seller,
        amountOre: -500,
        reason: 'Wrong scope',
      },
    }),
    /not found/,
  )
  for (const denied of [
    await connect('lifecycle:propose', 'invalid-token'),
    await connect('lifecycle:propose', token, randomUUID()),
  ])
    assert(
      (
        await denied.callTool({
          name: 'komisio_propose_markdown_batch',
          arguments: {
            requestId: randomUUID(),
            expiresAt,
            items: [{ itemId: item, step: 1 }],
          },
        })
      ).isError,
    )
}
