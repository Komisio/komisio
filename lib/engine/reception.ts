import { z } from 'zod'
import { currencyCode } from './money'
import { locales } from '../i18n'

const revision = z.number().int().nonnegative().max(2147483646)
const text = (max: number) => z.string().trim().min(1).max(max)
const sourceIds = z
  .array(z.uuid())
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length)
export const receptionSession = z.strictObject({
  schemaVersion: z.literal(1),
  tenantId: z.uuid(),
  sessionId: z.guid(),
  sellerId: z.uuid(),
  revision,
  sources: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(['photo', 'observation', 'price-evidence']),
        // Trusted adapter supplies the reference; a model cannot upload or resolve it.
        reference: text(500),
        observation: z.string().trim().max(2000),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (sources) => new Set(sources.map((s) => s.id)).size === sources.length,
    ),
})

/** A saved draft may be empty after removing its last photo. AI input may not. */
export const receptionDraftSources = z.union([
  receptionSession.shape.sources,
  z.tuple([]),
])

const fact = z.strictObject({
  value: text(1000),
  sourceIds,
  certainty: z.enum(['observed', 'tentative']),
})
export const garmentSuggestions = z.strictObject({
  description: fact.optional(),
  category: fact.optional(),
  color: fact.optional(),
  brand: fact.optional(),
  size: fact.optional(),
  material: fact.optional(),
  condition: fact.optional(),
})

// Exact decimal text at the interchange boundary, no floating-point arithmetic.
// A suggested price is not a booking, payout, tax calculation or sale approval.
export const suggestedPrice = z.strictObject({
  currency: currencyCode,
  amount: z
    .string()
    .regex(/^(?:0|[1-9]\d{0,5})\.\d{2}$/)
    .refine((v) => v !== '0.00'),
  rationale: text(2000),
  sourceIds,
})

// Model output never supplies identity, revision, approval, terms or timestamps.
/** One observation about an item, bound to the definition version it was
 * recorded under so that editing a definition later cannot change what it
 * meant. The slug is validated against a shape, never against a fixed list:
 * that is the whole point of a vocabulary a store can extend. */
export const itemAttribute = z.strictObject({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  definitionVersion: z.number().int().positive(),
  value: text(1000),
  sourceIds,
  certainty: z.enum(['observed', 'tentative']),
})
export type ItemAttribute = z.infer<typeof itemAttribute>

export const receptionSuggestions = z.strictObject({
  /** What the item is. The only descriptive shape there is. */
  attributes: z.array(itemAttribute).max(100),
  price: suggestedPrice.nullable(),
  questions: z.array(text(500)).max(10),
  itemType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .optional(),
  /** Reviews published before the seven fixed keys were retired still carry
   * them. Nothing reads this; it is here so an old row parses. */
  metadata: garmentSuggestions.optional(),
})

/** The order the seven were shown in before item types existed. A display
 * preference for screens that list attributes, not a schema: an attribute
 * outside it sorts after, alphabetically. */
export const legacySlugOrder = [
  'description',
  'category',
  'brand',
  'size',
  'color',
  'material',
  'condition',
] as const
export type ReceptionSession = z.infer<typeof receptionSession>
export type ReceptionSuggestions = z.infer<typeof receptionSuggestions>

export const receptionProposal = z.strictObject({
  schemaVersion: z.literal(1),
  proposalId: z.uuid(),
  tenantId: z.uuid(),
  sessionId: z.guid(),
  sellerId: z.uuid(),
  baseRevision: revision,
  suggestions: receptionSuggestions,
})

/** Pure validation/preparation only. The calling server must authorize sources. */
export function prepareReceptionProposal(
  sessionInput: unknown,
  candidate: unknown,
  proposalId: string,
) {
  const session = receptionSession.parse(sessionInput)
  const suggestions = receptionSuggestions.parse(candidate)
  const known = new Set(session.sources.map((source) => source.id))
  const pricing = new Set(
    session.sources
      .filter((source) => source.kind === 'price-evidence')
      .map((source) => source.id),
  )
  for (const fact of suggestions.attributes)
    if (fact.sourceIds.some((id) => !known.has(id)))
      throw new Error('RECEPTION_UNKNOWN_SOURCE')
  if (suggestions.price?.sourceIds.some((id) => !pricing.has(id)))
    throw new Error('RECEPTION_PRICE_EVIDENCE_REQUIRED')
  return receptionProposal.parse({
    schemaVersion: 1,
    proposalId,
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    sellerId: session.sellerId,
    baseRevision: session.revision,
    suggestions,
  })
}

const reviewTerms = z.strictObject({
  versionId: z.uuid(),
  body: text(20000),
  language: z.enum(locales),
})
const sellerReview = z.strictObject({
  schemaVersion: z.literal(1),
  reviewId: z.uuid(),
  proposal: receptionProposal,
  terms: reviewTerms,
  expiresAt: z.iso.datetime(),
})
export type SellerReview = z.infer<typeof sellerReview>

function sameSession(
  session: ReceptionSession,
  proposal: z.infer<typeof receptionProposal>,
) {
  if (
    session.tenantId !== proposal.tenantId ||
    session.sessionId !== proposal.sessionId ||
    session.sellerId !== proposal.sellerId
  )
    throw new Error('RECEPTION_CONTEXT_CHANGED')
  if (session.revision !== proposal.baseRevision)
    throw new Error('RECEPTION_CHANGED')
}

/** Staff-selected terms and a current proposal form a preview, not sent consent. */
export function prepareSellerReview(
  sessionInput: unknown,
  proposalInput: unknown,
  reviewId: string,
  termsInput: unknown,
  expiresAt: string,
  now: Date,
) {
  const session = receptionSession.parse(sessionInput)
  const proposal = receptionProposal.parse(proposalInput)
  sameSession(session, proposal)
  // Recheck source bindings rather than trusting a caller-created proposal.
  prepareReceptionProposal(session, proposal.suggestions, proposal.proposalId)
  if (
    !proposal.suggestions.attributes.some((a) => a.slug === 'description') ||
    !proposal.suggestions.price ||
    proposal.suggestions.questions.length
  )
    throw new Error('RECEPTION_REVIEW_INCOMPLETE')
  if (
    proposal.suggestions.attributes.some(
      (fact) => fact.certainty === 'tentative',
    )
  )
    throw new Error('RECEPTION_UNCERTAINTY_REQUIRES_REVIEW')
  const review = sellerReview.parse({
    schemaVersion: 1,
    reviewId,
    proposal,
    terms: termsInput,
    expiresAt,
  })
  if (
    !Number.isFinite(now.getTime()) ||
    Date.parse(review.expiresAt) <= now.getTime()
  )
    throw new Error('RECEPTION_REVIEW_EXPIRED')
  return { persisted: false as const, availableForSale: false as const, review }
}

const decisionRequest = z.strictObject({
  reviewId: z.uuid(),
  decision: z.enum(['approve', 'decline']),
})
const sellerContext = z.strictObject({ tenantId: z.uuid(), sellerId: z.uuid() })

/** Adapter provides verified identity and CURRENT stored snapshot in durable use.
 * This preview function neither authenticates the caller nor records a decision.
 */
export function previewSellerDecision(
  sessionInput: unknown,
  reviewInput: unknown,
  requestInput: unknown,
  verifiedSellerInput: unknown,
  now: Date,
) {
  const session = receptionSession.parse(sessionInput)
  const review = sellerReview.parse(reviewInput)
  const request = decisionRequest.parse(requestInput)
  const seller = sellerContext.parse(verifiedSellerInput)
  sameSession(session, review.proposal)
  if (
    seller.tenantId !== session.tenantId ||
    seller.sellerId !== session.sellerId
  )
    throw new Error('RECEPTION_SELLER_MISMATCH')
  if (request.reviewId !== review.reviewId)
    throw new Error('RECEPTION_REVIEW_CHANGED')
  // Revalidate even when the caller did not use prepareSellerReview.
  prepareSellerReview(
    session,
    review.proposal,
    review.reviewId,
    review.terms,
    review.expiresAt,
    now,
  )
  return {
    persisted: false as const,
    availableForSale: false as const,
    reviewId: review.reviewId,
    decision: request.decision,
    requiresStoreAcceptance: true as const,
  }
}
