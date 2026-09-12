import { publishStorePolicyCommand } from './store-policy'
import { publishSellerTermsCommand } from './seller-terms'
import { acceptItemCommand } from './items'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveInspectionCommand, archiveInspectionCommand } from './inspection'
import {
  createReceptionCommand,
  saveReceptionSourcesCommand,
  publishReceptionReviewCommand,
} from './reception-store'

export const intakeCommand = z.discriminatedUnion('action', [
  publishStorePolicyCommand,
  publishSellerTermsCommand,
  acceptItemCommand,
  publishReceptionReviewCommand,
  createReceptionCommand,
  saveReceptionSourcesCommand,
  saveInspectionCommand,
  archiveInspectionCommand,
  z
    .object({
      action: z.literal('registerSeller'),
      tenantId: z.uuid(),
      requestId: z.uuid(),
      name: z.string().trim().min(1).max(120),
      email: z.union([z.literal(''), z.email().max(254)]),
      phone: z.string().trim().max(40),
    })
    .refine((v) => v.email !== '' || v.phone !== ''),
  z.object({
    action: z.literal('receiveBag'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sellerId: z.uuid(),
    note: z.string().trim().max(500),
    expectedAgreementId: z.uuid().nullable().default(null),
  }),
  z.object({
    action: z.literal('receiveGarment'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sessionId: z.uuid(),
    note: z.string().trim().max(500),
  }),
  z.object({
    action: z.literal('registerPurchase'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    supplierNote: z.string().trim().max(500),
    // Exact decimal text at the boundary; öre in the database, never float.
    purchasePrice: z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{2}$/),
    evidenceReference: z.string().trim().min(1).max(500),
    marginEligible: z.boolean(),
  }),
  z.object({
    action: z.literal('publishAgreement'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    expectedCurrentId: z.uuid().nullable(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(12000),
    language: z.enum(['sv', 'en']),
    required: z.boolean(),
  }),
  z.object({
    action: z.literal('recordEvidence'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sellerId: z.uuid(),
    agreementId: z.uuid(),
    reference: z.string().trim().min(1).max(500),
  }),
])

// All callers use the authenticated client; SQL independently authorizes the actor.
export async function executeIntake(client: SupabaseClient, input: unknown) {
  const c = intakeCommand.parse(input)
  switch (c.action) {
    case 'publishStorePolicy':
      return client.rpc('publish_store_policy', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_expected_current: c.expectedCurrentId,
        p_policy: c.policy,
      })
    case 'publishSellerTerms':
      return client.rpc('publish_seller_terms', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
        p_expected_current: c.expectedCurrentId,
        p_basis: c.commissionBasis,
        p_rate: c.commissionRatePercent,
        p_notes: c.notes,
      })
    case 'acceptItem':
      return client.rpc('accept_item', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_origin_kind: c.originKind,
        p_origin_id: c.originId,
        p_origin_revision: c.originRevision,
        p_price_ore: oreFromDecimal(c.price),
      })
    case 'publishReceptionReview':
      return client.rpc('publish_reception_review', {
        p_tenant: c.tenantId,
        p_request: c.requestId,
        p_session: c.sessionId,
        p_source_revision: c.sourceRevision,
        p_previous: c.previousReviewId,
        p_agreement: c.agreementId,
        p_suggestions: c.suggestions,
        p_expires: c.expiresAt,
      })
    case 'registerPurchase':
      return client.rpc('register_purchase', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_note: c.supplierNote,
        p_price_ore: oreFromDecimal(c.purchasePrice),
        p_evidence: c.evidenceReference,
        p_margin_eligible: c.marginEligible,
      })
    case 'receiveGarment':
      return client.rpc('receive_garment', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_session: c.sessionId,
        p_note: c.note,
      })
    case 'createReception':
      return client.rpc('create_reception_session', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
      })
    case 'saveReceptionSources':
      return client.rpc('save_reception_sources', {
        p_tenant: c.tenantId,
        p_request: c.requestId,
        p_session: c.sessionId,
        p_expected: c.expectedRevision,
        p_sources: c.sources,
      })
    case 'archiveInspection':
      return client.rpc('set_inspection_archived', {
        p_tenant: c.tenantId,
        p_request: c.requestId,
        p_bag: c.bagId,
        p_draft: c.draftId,
        p_expected: c.expectedRevision,
        p_archived: c.archived,
        p_reason: c.reason,
      })
    case 'saveInspection':
      return client.rpc('save_inspection_draft', {
        p_tenant: c.tenantId,
        p_request: c.requestId,
        p_bag: c.bagId,
        p_draft: c.draftId,
        p_expected: c.expectedRevision,
        p_description: c.fields.description,
        p_category: c.fields.category,
        p_condition: c.fields.condition,
      })
    case 'registerSeller':
      return client.rpc('register_seller', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_name: c.name,
        p_email: c.email,
        p_phone: c.phone,
      })
    case 'receiveBag':
      return client.rpc('receive_bag_with_agreement', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
        p_note: c.note,
        p_expected_agreement: c.expectedAgreementId,
      })
    case 'publishAgreement':
      return client.rpc('publish_seller_agreement', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_expected_current: c.expectedCurrentId,
        p_title: c.title,
        p_body: c.body,
        p_language: c.language,
        p_required: c.required,
      })
    case 'recordEvidence':
      return client.rpc('record_agreement_evidence', {
        p_tenant: c.tenantId,
        p_id: c.requestId,
        p_seller: c.sellerId,
        p_agreement: c.agreementId,
        p_reference: c.reference,
      })
  }
}

export type Seller = { id: string; name: string; email: string; phone: string }
export type BagReceipt = {
  id: string
  seller_id: string
  reference: number
  note: string
  received_at: string
}
export type SellerAgreement = {
  id: string
  version: number
  title: string
  body: string
  language: 'sv' | 'en'
  required_before_receipt: boolean
  created_at: string
}
export type AgreementEvidence = {
  id: string
  agreement_id: string
  reference: string
  recorded_at: string
}

/** "250.50" -> 25050 without floating-point arithmetic. */
export function oreFromDecimal(input: string) {
  const m = /^(\d+)\.(\d{2})$/.exec(input)
  if (!m) throw new Error('INVALID_INPUT')
  return Number(m[1]) * 100 + Number(m[2])
}
