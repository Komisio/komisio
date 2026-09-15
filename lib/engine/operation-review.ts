import { readStorePolicy } from './store-policy'
import { compareReceptionReview } from './reception-review-comparison'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  operationRow,
  operationKind,
  publishReceptionReviewPayload,
  saveInspectionDraftPayload,
  acceptItemPayload,
  recordReturnPayload,
  adjustLedgerPayload,
  bulkItemUpdatePayload,
  approvePayoutPayload,
  exportDayClosePayload,
  settlePayoutsPayload,
  updateStoreProfilePayload,
  type PendingOperation,
} from './operations'
import { readSellerBalance } from './seller-ledger'
import { inspectionFields } from './inspection'
import { receptionSession } from './reception'

export const operationReviewInput = z.strictObject({ operationId: z.uuid() })

/** Exact immutable proposal context. Current-state hints are not authorization. */
export async function readOperationReview(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
  allowedKind?: PendingOperation['kind'],
) {
  const tenantId = z.uuid().parse(tenantInput)
  const { operationId } = operationReviewInput.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (
    role.error ||
    !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
  )
    throw new Error('FORBIDDEN')
  const pending = await client
    .from('pending_operations')
    .select(
      'id,kind,risk_level,actor_kind,actor_label,proposed_by,payload,expires_at,created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', operationId)
    .maybeSingle()
  if (pending.error || !pending.data) throw new Error('OPERATION_NOT_FOUND')
  if (!operationKind.safeParse(pending.data.kind).success)
    throw new Error('OPERATION_NOT_FOUND')
  if (allowedKind && pending.data.kind !== allowedKind)
    throw new Error('OPERATION_NOT_FOUND')
  if (pending.data.kind === 'saveInspectionDraft') {
    const p = saveInspectionDraftPayload.parse(pending.data.payload)
    const [base, current, decision] = await Promise.all([
      client
        .from('inspection_draft_revisions')
        .select('description,category,condition')
        .eq('tenant_id', tenantId)
        .eq('bag_id', p.bagId)
        .eq('draft_id', p.draftId)
        .eq('revision', p.expectedRevision)
        .single(),
      client
        .from('inspection_current')
        .select('revision,archived')
        .eq('tenant_id', tenantId)
        .eq('bag_id', p.bagId)
        .eq('draft_id', p.draftId)
        .maybeSingle(),
      client
        .from('operation_decisions')
        .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
        .eq('tenant_id', tenantId)
        .eq('operation_id', operationId)
        .maybeSingle(),
    ])
    if (base.error || current.error || decision.error)
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const before = inspectionFields.parse(base.data),
      after = p.fields
    const fields = ['description', 'category', 'condition'] as const
    const stale =
      current.data?.revision !== p.expectedRevision || !!current.data?.archived
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'inspection' as const,
        before,
        after,
        changes: fields
          .filter((f) => before[f] !== after[f])
          .map((field) => ({
            field,
            before: before[field],
            after: after[field],
          })),
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  if (pending.data.kind === 'acceptItem') {
    const p = acceptItemPayload.parse(pending.data.payload)
    const [existing, decision, currentDraft, currentReview] = await Promise.all(
      [
        client
          .from('items')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('origin_kind', p.originKind)
          .eq('origin_id', p.originId)
          .maybeSingle(),
        client
          .from('operation_decisions')
          .select(
            'id,outcome,result_id,error_code,reason,decided_by,created_at',
          )
          .eq('tenant_id', tenantId)
          .eq('operation_id', operationId)
          .maybeSingle(),
        p.originKind === 'inspection_draft'
          ? client
              .from('inspection_current')
              .select('revision,archived')
              .eq('tenant_id', tenantId)
              .eq('draft_id', p.originId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        p.originKind === 'reception_review'
          ? client
              .from('reception_reviews_current')
              .select('version')
              .eq('tenant_id', tenantId)
              .eq('session_id', p.originId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ],
    )
    if (
      existing.error ||
      decision.error ||
      currentDraft.error ||
      currentReview.error
    )
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const originCurrent =
      p.originKind === 'inspection_draft'
        ? currentDraft.data?.revision === p.originRevision &&
          !currentDraft.data?.archived
        : p.originKind === 'reception_review'
          ? currentReview.data?.version === p.originRevision
          : true
    // Already accepted by anyone else, or the origin moved on: the proposal is stale.
    const stale = (!!existing.data && !d) || !originCurrent
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'acceptance' as const,
        originKind: p.originKind,
        originId: p.originId,
        originRevision: p.originRevision,
        priceOre: p.priceOre,
        alreadyAccepted: !!existing.data,
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  if (
    pending.data.kind === 'recordReturn' ||
    pending.data.kind === 'adjustLedger' ||
    pending.data.kind === 'applyMarkdownBatch' ||
    pending.data.kind === 'approvePayout' ||
    pending.data.kind === 'markPayoutPaid' ||
    pending.data.kind === 'sendMessage' ||
    pending.data.kind === 'exportDayClose' ||
    pending.data.kind === 'updateStoreProfile' ||
    pending.data.kind === 'importSellers'
  ) {
    // P2 kinds carry their own facts; the only cheap hint is whether the
    // subject still exists or is already done. SQL rechecks on approval.
    const kind = pending.data.kind
    const [decision, subject] = await Promise.all([
      client
        .from('operation_decisions')
        .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
        .eq('tenant_id', tenantId)
        .eq('operation_id', operationId)
        .maybeSingle(),
      kind === 'recordReturn'
        ? client
            .from('sale_returns')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq(
              'sale_line_id',
              recordReturnPayload.parse(pending.data.payload).saleLineId,
            )
            .maybeSingle()
        : kind === 'updateStoreProfile'
          ? client
              .from('store_profile_versions')
              .select('id')
              .eq('tenant_id', tenantId)
              .order('version', { ascending: false })
              .limit(1)
              .maybeSingle()
          : kind === 'exportDayClose'
            ? client
                .from('day_closes')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq(
                  'id',
                  exportDayClosePayload.parse(pending.data.payload).dayCloseId,
                )
                .maybeSingle()
            : kind === 'adjustLedger' || kind === 'sendMessage'
              ? client
                  .from('sellers')
                  .select('id,email')
                  .eq('tenant_id', tenantId)
                  .eq(
                    'id',
                    adjustLedgerPayload.pick({ sellerId: true }).parse({
                      sellerId: (pending.data.payload as { sellerId: string })
                        .sellerId,
                    }).sellerId,
                  )
                  .maybeSingle()
              : kind === 'approvePayout' || kind === 'markPayoutPaid'
                ? client
                    .from('payouts')
                    .select('id,status')
                    .eq('tenant_id', tenantId)
                    .eq(
                      'id',
                      approvePayoutPayload.pick({ payoutId: true }).parse({
                        payoutId: (pending.data.payload as { payoutId: string })
                          .payoutId,
                      }).payoutId,
                    )
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null }),
    ])
    if (decision.error || subject.error) throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const alreadyDone = kind === 'recordReturn' && !!subject.data && !d
    const payoutStatus = (subject.data as { status?: string } | null)?.status
    // A payout proposal is stale once the payout left the status it targets.
    const payoutStale =
      (kind === 'approvePayout' &&
        (!subject.data || (!d && payoutStatus !== 'requested'))) ||
      (kind === 'markPayoutPaid' &&
        (!subject.data || (!d && payoutStatus !== 'approved')))
    const sellerEmail = (subject.data as { email?: string } | null)?.email
    // A profile proposal is stale once another version was published.
    const profileStale =
      kind === 'updateStoreProfile' &&
      !d &&
      ((subject.data as { id?: string } | null)?.id ?? null) !==
        updateStoreProfilePayload.parse(pending.data.payload).expectedCurrentId
    const stale =
      alreadyDone ||
      profileStale ||
      (kind === 'adjustLedger' && !subject.data) ||
      (kind === 'sendMessage' && (!subject.data || !sellerEmail)) ||
      (kind === 'exportDayClose' && !subject.data) ||
      payoutStale
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'engine' as const,
        alreadyDone,
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  if (pending.data.kind === 'settlePayouts') {
    // Preview: each seller's available balance now next to the proposed
    // amount. SQL rechecks threshold, balance and open payouts on approval.
    const p = settlePayoutsPayload.parse(pending.data.payload)
    const ids = p.sellers.map((s) => s.sellerId)
    const [decision, sellers, open, balances] = await Promise.all([
      client
        .from('operation_decisions')
        .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
        .eq('tenant_id', tenantId)
        .eq('operation_id', operationId)
        .maybeSingle(),
      client
        .from('sellers')
        .select('id,name')
        .eq('tenant_id', tenantId)
        .in('id', ids),
      client
        .from('payouts')
        .select('seller_id')
        .eq('tenant_id', tenantId)
        .in('seller_id', ids)
        .in('status', ['requested', 'approved']),
      Promise.all(
        ids.map((id) =>
          readSellerBalance(client, tenantId, id).catch(() => null),
        ),
      ),
    ])
    if (decision.error || sellers.error || open.error)
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const names = new Map(
      z
        .array(z.object({ id: z.uuid(), name: z.string() }))
        .parse(sellers.data)
        .map((s) => [s.id, s.name]),
    )
    const pendingSellers = new Set(
      z
        .array(z.object({ seller_id: z.uuid() }))
        .parse(open.data)
        .map((r) => r.seller_id),
    )
    const rows = p.sellers.map((s, i) => ({
      sellerId: s.sellerId,
      name: names.get(s.sellerId) ?? null,
      amountOre: s.amountOre,
      availableOre: balances[i]?.availableOre ?? null,
      // After execution the batch's own payouts are the open ones.
      openPayout: !d && pendingSellers.has(s.sellerId),
    }))
    const stale =
      !d &&
      rows.some(
        (r) =>
          r.name === null ||
          r.availableOre === null ||
          r.amountOre > r.availableOre ||
          r.openPayout,
      )
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'settlement' as const,
        rows,
        totalOre: p.sellers.reduce((sum, s) => sum + s.amountOre, 0),
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  if (pending.data.kind === 'bulkItemUpdate') {
    // Preview: each item's current price next to the proposed change. SQL
    // rechecks sold and ended state on approval; a missing item is stale here.
    const p = bulkItemUpdatePayload.parse(pending.data.payload)
    const ids = p.items.map((i) => i.itemId)
    const [decision, items, prices] = await Promise.all([
      client
        .from('operation_decisions')
        .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
        .eq('tenant_id', tenantId)
        .eq('operation_id', operationId)
        .maybeSingle(),
      client.from('items').select('id').eq('tenant_id', tenantId).in('id', ids),
      client
        .from('item_prices')
        .select('item_id,price_ore')
        .eq('tenant_id', tenantId)
        .in('item_id', ids)
        .order('set_at', { ascending: false })
        .order('seq', { ascending: false }),
    ])
    if (decision.error || items.error || prices.error)
      throw new Error('OPERATION_NOT_FOUND')
    const d = decision.data,
      expired = Date.parse(pending.data.expires_at) <= Date.now()
    const operation = operationRow.parse({
      ...pending.data,
      status: d?.outcome ?? (expired ? 'expired' : 'open'),
      decision_id: d?.id ?? null,
      outcome: d?.outcome ?? null,
      result_id: d?.result_id ?? null,
      error_code: d?.error_code ?? null,
      reason: d?.reason ?? null,
      decided_by: d?.decided_by ?? null,
      decided_at: d?.created_at ?? null,
    })
    const current = new Map<string, number>()
    for (const row of z
      .array(
        z.object({
          item_id: z.guid(),
          price_ore: z.union([z.number(), z.string()]).transform(Number),
        }),
      )
      .parse(prices.data))
      if (!current.has(row.item_id)) current.set(row.item_id, row.price_ore)
    const known = new Set((items.data ?? []).map((i) => i.id as string))
    const rows = p.items.map((i) => ({
      itemId: i.itemId,
      exists: known.has(i.itemId),
      currentPriceOre: current.get(i.itemId) ?? null,
      newPriceOre:
        p.action === 'setPrice' ? (i as { priceOre: number }).priceOre : null,
    }))
    const stale = rows.some((r) => !r.exists)
    return {
      readOnly: true as const,
      evidenceIsUntrusted: true as const,
      operation,
      context: {
        kind: 'bulk' as const,
        action: p.action,
        rows,
        stale,
        canApprove: !d && !expired && !stale,
        guidanceOnly: true as const,
      },
    }
  }
  const p = publishReceptionReviewPayload.parse(pending.data.payload)
  const policy = await readStorePolicy(client, tenantId)
  const [
    terms,
    sources,
    decision,
    currentSource,
    currentAgreement,
    currentReview,
    previousReview,
  ] = await Promise.all([
    p.agreementId
      ? client
          .from('seller_agreement_versions')
          .select('id,title,body,language,version')
          .eq('tenant_id', tenantId)
          .eq('id', p.agreementId)
          .single()
      : Promise.resolve({ data: null, error: null }),
    client
      .from('reception_source_revisions')
      .select('sources')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .eq('revision', p.sourceRevision)
      .single(),
    client
      .from('operation_decisions')
      .select('id,outcome,result_id,error_code,reason,decided_by,created_at')
      .eq('tenant_id', tenantId)
      .eq('operation_id', operationId)
      .maybeSingle(),
    client
      .from('reception_sources_current')
      .select('revision')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .maybeSingle(),
    client
      .from('seller_agreement_versions')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('reception_reviews')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('session_id', p.sessionId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    p.previousReviewId
      ? client
          .from('reception_reviews')
          .select('id,version,source_revision,agreement_id,suggestions')
          .eq('tenant_id', tenantId)
          .eq('session_id', p.sessionId)
          .eq('id', p.previousReviewId)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (
    [
      terms,
      sources,
      decision,
      currentSource,
      currentAgreement,
      currentReview,
      previousReview,
    ].some((r) => r.error)
  )
    throw new Error('OPERATION_NOT_FOUND')
  const d = decision.data
  const expired =
    Date.parse(pending.data.expires_at) <= Date.now() ||
    Date.parse(p.expiresAt) <= Date.now()
  const operation = operationRow.parse({
    ...pending.data,
    status: d?.outcome ?? (expired ? 'expired' : 'open'),
    decision_id: d?.id ?? null,
    outcome: d?.outcome ?? null,
    result_id: d?.result_id ?? null,
    error_code: d?.error_code ?? null,
    reason: d?.reason ?? null,
    decided_by: d?.decided_by ?? null,
    decided_at: d?.created_at ?? null,
  })
  const stale =
    (p.agreementId === null &&
      policy.policy.agreementRequiredFor.includes('review_publication')) ||
    currentSource.data?.revision !== p.sourceRevision ||
    (currentAgreement.data?.id ?? null) !== p.agreementId ||
    (currentReview.data?.id ?? null) !== p.previousReviewId
  return {
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    operation,
    context: {
      kind: 'reception' as const,
      comparison: compareReceptionReview(previousReview.data, p),
      terms: z
        .object({
          id: z.uuid(),
          title: z.string(),
          body: z.string(),
          language: z.string(),
          version: z.number().int(),
        })
        .nullable()
        .parse(terms.data),
      sources: receptionSession.shape.sources
        .parse(sources.data?.sources)
        .map((s) => ({
          id: s.id,
          kind: s.kind,
          observation: s.observation,
          reference: s.kind === 'photo' ? null : s.reference,
        })),
      stale,
      canApprove: !d && !expired && !stale,
      guidanceOnly: true as const,
    },
  }
}
export type OperationReviewContext = Awaited<
  ReturnType<typeof readOperationReview>
>['context']
