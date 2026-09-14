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
  // Message: only the free-text block; low risk; SQL queues nothing, the store sends after approval.
  const messages = await connect('communications:propose')
  assert.deepEqual(
    (await messages.listTools()).tools.map((t) => t.name),
    ['komisio_propose_message'],
  )
  const message = randomUUID()
  const messageStaged = await messages.callTool({
    name: 'komisio_propose_message',
    arguments: {
      requestId: message,
      expiresAt,
      sellerId: seller,
      locale: 'sv',
      freeText: 'MCP fixture: extra öppet på lördag.',
    },
  })
  assert(!messageStaged.isError, JSON.stringify(messageStaged.content))
  assert.equal(messageStaged.structuredContent.riskLevel, 'low')
  assert.equal(messageStaged.structuredContent.templateBound, true)
  for (const args of [
    {
      requestId: randomUUID(),
      expiresAt,
      sellerId: seller,
      locale: 'sv',
      freeText: '',
    },
    {
      requestId: randomUUID(),
      expiresAt,
      sellerId: seller,
      locale: 'de',
      freeText: 'Hallo',
    },
    {
      requestId: randomUUID(),
      expiresAt,
      sellerId: seller,
      locale: 'sv',
      freeText: 'x',
      subject: 'Injected',
    },
  ])
    assert(
      (
        await messages.callTool({
          name: 'komisio_propose_message',
          arguments: args,
        })
      ).isError,
      JSON.stringify(args),
    )
  await rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: message,
    p_decision: 'approved',
    p_reason: 'Low risk: proposer approves',
  })
  const messageState = (
    await db.query(
      'select (select outcome from operation_decisions where operation_id=$1) outcome,(select count(*)::int from seller_communications where id=$1) queued',
      [message],
    )
  ).rows[0]
  assert.deepEqual(messageState, { outcome: 'executed', queued: 0 })
  // Payouts: proposers exist under their own scope; an unknown payout is refused at preflight.
  const payouts = await connect('payouts:propose')
  assert.deepEqual(
    (await payouts.listTools()).tools.map((t) => t.name).sort(),
    [
      'komisio_list_settlement_candidates',
      'komisio_propose_payout_approval',
      'komisio_propose_payout_payment',
      'komisio_propose_settlement',
    ],
  )
  // Settlement: the fixture seller has no balance, so it is no candidate and
  // a batch naming it is refused at preflight; names never leave the store.
  const candidates = await payouts.callTool({
    name: 'komisio_list_settlement_candidates',
    arguments: {},
  })
  assert(!candidates.isError, JSON.stringify(candidates.content))
  assert.equal(candidates.structuredContent.thresholdOre, 10000)
  assert.deepEqual(candidates.structuredContent.sellers, [])
  assert(!JSON.stringify(candidates.content).includes('MCP test seller'))
  const settlement = await payouts.callTool({
    name: 'komisio_propose_settlement',
    arguments: {
      requestId: randomUUID(),
      expiresAt,
      sellers: [{ sellerId: seller, amountOre: 10000 }],
      reason: 'MCP fixture settlement',
    },
  })
  assert(settlement.isError)
  assert(
    JSON.stringify(settlement.content).includes('PAYOUT_EXCEEDS_BALANCE'),
    JSON.stringify(settlement.content),
  )
  assert(
    (
      await payouts.callTool({
        name: 'komisio_propose_settlement',
        arguments: {
          requestId: randomUUID(),
          expiresAt,
          sellers: [
            { sellerId: seller, amountOre: 10000 },
            { sellerId: seller, amountOre: 10000 },
          ],
          reason: 'Twice',
        },
      })
    ).isError,
    'each seller once',
  )
  const unknownPayout = await payouts.callTool({
    name: 'komisio_propose_payout_approval',
    arguments: {
      requestId: randomUUID(),
      expiresAt,
      payoutId: randomUUID(),
      reason: '',
    },
  })
  assert(unknownPayout.isError)
  assert(JSON.stringify(unknownPayout.content).includes('PAYOUT_NOT_FOUND'))
  assert(
    (
      await payouts.callTool({
        name: 'komisio_propose_payout_payment',
        arguments: {
          requestId: randomUUID(),
          expiresAt,
          payoutId: randomUUID(),
          reference: '',
          reason: '',
        },
      })
    ).isError,
    'a payment needs a reference',
  )
  // Accounting: reads list closes and preview the voucher; the export proposal needs a map.
  const closeId = randomUUID()
  await rpc('generate_day_close', {
    p_tenant: tenant,
    p_id: closeId,
    p_date: new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Stockholm',
    }),
  })
  const accounting = await connect('accounting:read,accounting:propose')
  assert.deepEqual(
    (await accounting.listTools()).tools.map((t) => t.name).sort(),
    [
      'komisio_list_day_closes',
      'komisio_preview_day_close_voucher',
      'komisio_propose_day_close_export',
      'komisio_read_accounting_reconciliation',
    ],
  )
  const reconciliation = await accounting.callTool({
    name: 'komisio_read_accounting_reconciliation',
    arguments: { from: '2026-01-01', to: '2026-12-31' },
  })
  assert(!reconciliation.isError, JSON.stringify(reconciliation.content))
  assert.equal(reconciliation.structuredContent.amountUnit, 'ore')
  assert(Array.isArray(reconciliation.structuredContent.days))
  assert(
    (
      await accounting.callTool({
        name: 'komisio_read_accounting_reconciliation',
        arguments: { from: '2026-12-31', to: '2026-01-01' },
      })
    ).isError,
  )
  const closes = await accounting.callTool({
    name: 'komisio_list_day_closes',
    arguments: {},
  })
  assert(!closes.isError, JSON.stringify(closes.content))
  assert(closes.structuredContent.items.some((c) => c.dayCloseId === closeId))
  const voucher = await accounting.callTool({
    name: 'komisio_preview_day_close_voucher',
    arguments: { dayCloseId: closeId },
  })
  assert(!voucher.isError, JSON.stringify(voucher.content))
  assert.equal(voucher.structuredContent.mapVersion, 0)
  assert.equal(voucher.structuredContent.balanced, false)
  assert.equal(voucher.structuredContent.accountsAreTheTenants, true)
  const exportWithoutMap = await accounting.callTool({
    name: 'komisio_propose_day_close_export',
    arguments: { requestId: randomUUID(), expiresAt, dayCloseId: closeId },
  })
  assert(exportWithoutMap.isError)
  assert(
    JSON.stringify(exportWithoutMap.content).includes(
      'ACCOUNTING_MAP_REQUIRED',
    ),
  )
  assert(
    (
      await accounting.callTool({
        name: 'komisio_preview_day_close_voucher',
        arguments: { dayCloseId: randomUUID() },
      })
    ).isError,
  )
  // Store profile: read the (empty) profile, stage a version naming null, then
  // a stale one is refused; the owner approves and the profile is published.
  const store = await connect('store:read,store:propose')
  assert.deepEqual((await store.listTools()).tools.map((t) => t.name).sort(), [
    'komisio_propose_store_profile',
    'komisio_read_store_profile',
  ])
  const emptyProfile = await store.callTool({
    name: 'komisio_read_store_profile',
    arguments: {},
  })
  assert(!emptyProfile.isError, JSON.stringify(emptyProfile.content))
  assert.equal(emptyProfile.structuredContent.version, 0)
  assert.equal(emptyProfile.structuredContent.currentId, null)
  const profile = {
    address: { street: 'Storgatan 1', postalCode: '111 22', city: 'Stockholm' },
    contact: { email: '', phone: '', website: 'https://example.test' },
    openingHours: [{ day: 'sat', opens: '11:00', closes: '15:00' }],
    accepts: 'MCP fixture: clean garments.',
    concept: 'MCP fixture concept.',
    language: 'sv',
  }
  const profileOp = randomUUID()
  const profileStaged = await store.callTool({
    name: 'komisio_propose_store_profile',
    arguments: {
      requestId: profileOp,
      expiresAt,
      expectedCurrentId: null,
      profile,
    },
  })
  assert(!profileStaged.isError, JSON.stringify(profileStaged.content))
  assert.equal(profileStaged.structuredContent.riskLevel, 'low')
  assert.equal(
    profileStaged.structuredContent.executesOnlyForOwnerOrAdmin,
    true,
  )
  assert(
    (
      await store.callTool({
        name: 'komisio_propose_store_profile',
        arguments: {
          requestId: randomUUID(),
          expiresAt,
          expectedCurrentId: null,
          profile: {
            ...profile,
            contact: { ...profile.contact, website: 'http://plain' },
          },
        },
      })
    ).isError,
    'https only',
  )
  await rpc('decide_operation', {
    p_tenant: tenant,
    p_id: randomUUID(),
    p_operation: profileOp,
    p_decision: 'approved',
    p_reason: 'Owner approves the profile',
  })
  const published = await store.callTool({
    name: 'komisio_read_store_profile',
    arguments: {},
  })
  assert.equal(published.structuredContent.version, 1)
  assert.equal(published.structuredContent.currentId, profileOp)
  assert.equal(published.structuredContent.profile.concept, profile.concept)
  const staleProfile = await store.callTool({
    name: 'komisio_propose_store_profile',
    arguments: {
      requestId: randomUUID(),
      expiresAt,
      expectedCurrentId: null,
      profile,
    },
  })
  assert(staleProfile.isError)
  assert(JSON.stringify(staleProfile.content).includes('PROFILE_CHANGED'))
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
