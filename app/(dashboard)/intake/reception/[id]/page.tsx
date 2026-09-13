import { readStorePolicy } from '@/lib/engine/store-policy'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readReceptionSession,
  readReceptionReview,
} from '@/lib/engine/reception-store'
import { readManualReception } from '@/lib/engine/manual-reception'
import { PhotoUpload } from '@/components/reception/photo-upload'
import { ReceptionAssistance } from '@/components/reception/assistance'
import { receptionAIConfig } from '@/lib/assistance/reception-config'
import {
  ReceptionObservation,
  PublishReview,
  ReviewAccess,
} from '@/components/reception/operator'
import { RecordCustody } from '@/components/reception/custody'
import { AcceptItemForm } from '@/components/intake/accept-item-form'
import { readItemForOrigin } from '@/lib/engine/items'
import {
  readGarmentReceipt,
  garmentReference,
} from '@/lib/engine/garment-receipts'
export default async function Reception({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform(),
    tenant = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.reception
  const reception = await readReceptionSession(ctx.client, tenant.id, id.data)
  if (!reception) notFound()
  const state = reception.status === 'ready' ? reception.session : reception
  const sources = reception.status === 'ready' ? reception.session.sources : []
  const [seller, terms, review, policy, custody] = await Promise.all([
    ctx.client
      .from('sellers')
      .select('name,email,phone')
      .eq('tenant_id', tenant.id)
      .eq('id', state.sellerId)
      .single(),
    ctx.client
      .from('seller_agreement_versions')
      .select('id,title,body,language,version')
      .eq('tenant_id', tenant.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    readReceptionReview(ctx.client, tenant.id, id.data),
    readStorePolicy(ctx.client, tenant.id),
    readGarmentReceipt(ctx.client, tenant.id, id.data),
  ])
  if (seller.error || terms.error)
    throw new Error('Unable to read reception context')
  const accepted = await readItemForOrigin(
    ctx.client,
    tenant.id,
    'reception_review',
    id.data,
  )
  const prepared = readManualReception(
      sources,
      policy.policy.currency ?? 'SEK',
    ),
    write = tenant.role !== 'readonly'
  const current = review?.sourceRevision === state.revision,
    expired = review?.expired ?? false
  const canPublish =
    prepared &&
    (terms.data ||
      !policy.policy.agreementRequiredFor.includes('review_publication')) &&
    (!review ||
      !current ||
      expired ||
      (review.terms?.versionId ?? null) !== (terms.data?.id ?? null))
  return (
    <>
      <Link className="text-link" href="/intake/reception">
        {d.back}
      </Link>
      <div className="page-heading">
        <div className="eyebrow">{tenant.name}</div>
        <h1>{seller.data.name}</h1>
        <p>
          {d.sessionId}: {id.data}
        </p>
        <p>
          {d.recipient}: {seller.data.email || seller.data.phone}
        </p>
        <p>
          <Link
            className="text-link"
            href={`/intake/sellers/${state.sellerId}`}
          >
            {all.sellerTerms.title}
          </Link>
        </p>
      </div>
      <p className="intake-notice">{d.manual}</p>
      <p>
        <Link
          className="text-link"
          href={`/intake/reception/${id.data}/history`}
        >
          {d.history.title}
        </Link>
      </p>
      <section className="card intake-form reception-result">
        <h2>{d.custody}</h2>
        <p>{d.custodyHelp}</p>
        {custody ? (
          <>
            <p role="status">
              <strong>
                {d.custodyReference} {garmentReference(custody.reference)}
              </strong>{' '}
              · {d.custodyRecorded}{' '}
              {new Date(custody.received_at).toLocaleString(
                ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                { timeZone: 'Europe/Stockholm' },
              )}
              {custody.note ? ` · ${custody.note}` : ''}
            </p>
            <Link
              className="text-link"
              href={`/intake/reception/${id.data}/label`}
            >
              {d.custodyPrint}
            </Link>
          </>
        ) : (
          <>
            <p role="status">{d.custodyMissing}</p>
            {write && (
              <RecordCustody
                tenantId={tenant.id}
                sessionId={id.data}
                d={d}
                intake={all.intake}
              />
            )}
          </>
        )}
      </section>
      <section className="card intake-form reception-result">
        <h2>{all.items.acceptHeading}</h2>
        <p>{all.items.acceptHint}</p>
        {accepted ? (
          <p role="status">
            {all.items.alreadyAccepted}{' '}
            <Link className="text-link" href={`/intake/items/${accepted.id}`}>
              {all.items.open}
            </Link>
          </p>
        ) : !custody || !review ? (
          <p role="status">{all.items.acceptBlocked}</p>
        ) : write ? (
          <AcceptItemForm
            tenantId={tenant.id}
            originKind="reception_review"
            originId={id.data}
            originRevision={review.version}
            defaultPrice={review.suggestions.price?.amount}
            d={all.items}
            intake={all.intake}
          />
        ) : null}
      </section>
      <section className="card intake-form reception-result">
        <h2>{d.photos}</h2>
        {write && (
          <PhotoUpload
            key={state.revision}
            tenantId={tenant.id}
            sessionId={id.data}
            revision={state.revision}
            sources={sources}
            d={d}
          />
        )}
        <div className="reception-photos">
          {sources
            .filter((s) => s.kind === 'photo')
            .map((s) => (
              // Authenticated, uncached route; do not send private images through an optimizer cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.id}
                src={`/api/reception/${id.data}/photo?photo=${s.id}`}
                alt={d.photoAlt}
                loading="lazy"
              />
            ))}
        </div>
      </section>
      {write && (
        <ReceptionAssistance
          key={`ai-${state.revision}-${review?.id ?? 'none'}-${terms.data?.id ?? 'none'}`}
          tenantId={tenant.id}
          sessionId={id.data}
          sellerId={state.sellerId}
          revision={state.revision}
          sources={sources}
          available={!!receptionAIConfig(tenant.id, process.env, policy.policy)}
          terms={terms.data}
          agreementRequired={policy.policy.agreementRequiredFor.includes(
            'review_publication',
          )}
          previousId={review?.id ?? null}
          d={d}
        />
      )}
      <div className="intake-grid reception-workspace">
        <section className="card intake-form">
          <h2>{d.observe}</h2>
          <p>
            {d.sourceVersion} {state.revision}
          </p>
          {write ? (
            <ReceptionObservation
              key={state.revision}
              tenantId={tenant.id}
              sessionId={id.data}
              revision={state.revision}
              sources={sources}
              initial={prepared?.input ?? null}
              d={d}
            />
          ) : (
            <p>{d.readonly}</p>
          )}
        </section>
        <section className="card intake-form">
          <h2>{d.preview}</h2>
          {!prepared ? (
            <p>{d.needSources}</p>
          ) : (
            <>
              <p>{prepared.input.description}</p>
              <h3>
                {d.price}: {prepared.input.amount}{' '}
                {policy.policy.currency ?? 'SEK'}
              </h3>
              <p>{prepared.suggestions.price?.rationale}</p>
            </>
          )}
          {!terms.data ? (
            <p>
              <Link href="/intake/agreements" className="text-link">
                {policy.policy.agreementRequiredFor.includes(
                  'review_publication',
                )
                  ? d.needTerms
                  : all.storePolicy.noTerms}
              </Link>
            </p>
          ) : (
            <>
              <h3>
                {terms.data.title} ({d.version} {terms.data.version})
              </h3>
              <div lang={terms.data.language} className="reception-terms">
                {terms.data.body}
              </div>
            </>
          )}
          {write && canPublish && prepared ? (
            <PublishReview
              key={`${state.revision}-${review?.id ?? 'none'}-${terms.data?.id ?? 'none'}`}
              tenantId={tenant.id}
              sessionId={id.data}
              revision={state.revision}
              previousId={review?.id ?? null}
              agreementId={terms.data?.id ?? null}
              suggestions={prepared.suggestions}
              d={d}
            />
          ) : current && !expired ? (
            <p>{d.published}</p>
          ) : null}
        </section>
      </div>
      {review && (
        <section className="card intake-form reception-result">
          <h2>
            {d.sellerStep} — {d.version} {review.version}
          </h2>
          <p>{review.suggestions.metadata.description?.value}</p>
          <p>
            {d.price}: {review.suggestions.price?.amount}{' '}
            {review.suggestions.price?.currency}
          </p>
          <p>{review.terms?.title ?? all.storePolicy.noTerms}</p>
          <p>
            {d.sharedPhotos}: {review.photos.length}
          </p>
          {review.terms && (
            <details>
              <summary>{d.exactTerms}</summary>
              <div className="reception-terms" lang={review.terms.language}>
                {review.terms.body}
              </div>
            </details>
          )}
          <p>
            {all.reviewExpires}{' '}
            {new Date(review.expiresAt).toLocaleString(
              ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
              { timeZone: 'Europe/Stockholm' },
            )}{' '}
            (Europe/Stockholm)
          </p>
          {(!current || expired) && <p role="status">{d.stale}</p>}
          <p role="status">
            {review.response
              ? review.response.decision === 'approve'
                ? all.staffReviewApproved
                : all.staffReviewDeclined
              : d.awaiting}
          </p>
          {policy.policy.sellerReviewMode === 'delegated' && (
            <p>{d.delegatedNotice}</p>
          )}
          {write && review.terms && (
            <ReviewAccess
              key={review.id}
              tenantId={tenant.id}
              reviewId={review.id}
              access={review.access}
              available={current && !expired}
              email={review.sellerEmail}
              d={d}
            />
          )}
        </section>
      )}
    </>
  )
}
