'use client'
import { RegistrationFields } from '@/components/intake/registration-fields'
import { CreateItemType } from '@/components/intake/create-item-type'
import {
  questionsFor,
  labelOf,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'
import {
  useBusyState,
  useBusyTransition as useTransition,
} from '@/components/platform/work-activity'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type {
  ReceptionSession,
  ReceptionSuggestions,
} from '@/lib/engine/reception'
import {
  exactPrice,
  manualReceptionSources,
} from '@/lib/engine/manual-reception'
import {
  receptionReviewFields,
  reviewReceptionFacts,
  type ReceptionReviewField,
} from '@/lib/engine/reception-fact-review'
import { Button } from '@/components/ui/button'
import { useFormDirty } from '@/components/platform/use-form-dirty'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
type D = Dictionary['reception']
function useWrite(d: D) {
  const [busy, setBusy] = useBusyState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(''),
    [reload, setReload] = useState(false)
  const pending = useRef<{ path: string; body: object } | null>(null),
    running = useRef(false)
  const router = useRouter()
  async function run(path: string, body: object) {
    if (running.current || reload) return null
    pending.current ??= { path, body }
    // The server creates a fresh secret for a personal link. Replaying the
    // client request cannot recover that secret, so inspect an uncertain change.
    const accessRequest =
      pending.current.path === '/api/reception/access'
        ? (pending.current.body as { requestId: string; enabled: boolean })
        : null
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch(pending.current.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current.body),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(accessRequest ? d.linkUncertain : d.failed)
        setReload(true)
        return null
      }
      if (
        accessRequest &&
        (result?.id !== accessRequest.requestId ||
          (accessRequest.enabled
            ? typeof result?.path !== 'string' ||
              !/^\/review\/[a-f0-9]{64}$/.test(result.path)
            : result?.path !== null))
      ) {
        setError(d.linkUncertain)
        setReload(true)
        return null
      }
      const requestId = (pending.current.body as { requestId: string })
        .requestId
      if (result?.id !== requestId) {
        setError(d.retry)
        return null
      }
      pending.current = null
      setLocked(false)
      return result as { id: string; path?: string | null }
    } catch {
      setError(accessRequest ? d.linkUncertain : d.retry)
      if (accessRequest) setReload(true)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy, locked, error, reload, router }
}
function Failure({ action, d }: { action: ReturnType<typeof useWrite>; d: D }) {
  return (
    <>
      {action.error && <p role="alert">{action.error}</p>}
      {action.reload && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {d.reload}
        </Button>
      )}
    </>
  )
}
export function StartReception({
  tenantId,
  sellers,
  d,
}: {
  tenantId: string
  sellers: { id: string; name: string; email: string; phone: string }[]
  d: D
}) {
  const [seller, setSeller] = useState(
    sellers.length === 1 ? sellers[0].id : '',
  )
  const action = useWrite(d)
  return (
    <form
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        const result = await action.run('/api/intake', {
          action: 'createReception',
          tenantId,
          requestId: crypto.randomUUID(),
          sellerId: seller,
        })
        if (result) {
          action.router.push(`/intake/reception/${result.id}`)
          action.router.refresh()
        }
      }}
    >
      <div className="field">
        <label htmlFor="reception-seller">{d.seller}</label>
        <select
          id="reception-seller"
          value={seller}
          onChange={(e) => setSeller(e.target.value)}
          disabled={action.locked}
          required
        >
          <option value="" disabled>
            {d.seller}
          </option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.email || s.phone}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={!seller || action.busy || action.reload}>
        {action.locked ? d.retryButton : d.start}
      </Button>
      <Failure action={action} d={d} />
    </form>
  )
}
export function ReceptionObservation({
  tenantId,
  sessionId,
  revision,
  sources,
  initial,
  d,
  leaveUnsaved,
  vocabulary: initialVocabulary,
  typeLabels,
  typeSettings,
  initialNote = { id: null, note: '' },
  canManageTypes,
  locale,
}: {
  tenantId: string
  sessionId: string
  revision: number
  sources: ReceptionSession['sources']
  initial: {
    itemType?: string
    description: string
    attributes?: { slug: string; value: string }[]
    amount: string
    reference: string
    rationale: string
  } | null
  d: D
  vocabulary: AttributeVocabulary
  typeLabels: Dictionary['quickIntake']
  initialNote?: { id: string | null; note: string }
  typeSettings: Dictionary['vocabularySettings']
  canManageTypes: boolean
  locale: string
  leaveUnsaved: string
}) {
  const action = useWrite(d),
    [invalid, setInvalid] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const [vocabulary, setVocabulary] = useState(initialVocabulary)
  const [itemType, setItemType] = useState(initial?.itemType ?? '')
  const [creatingType, setCreatingType] = useState(false)
  const submittedFields = useRef<FormData | null>(null)
  const { ready, dirty, checkDirty, resetDirty } = useFormDirty(formRef)
  const wasCreatingType = useRef(false)
  useEffect(() => {
    if (wasCreatingType.current && !creatingType) {
      document.getElementById('garment-type')?.focus()
      checkDirty()
    }
    wasCreatingType.current = creatingType
  }, [creatingType, checkDirty])
  const [refreshing, refresh] = useTransition()
  useUnsavedChanges(dirty || action.locked ? leaveUnsaved : null)
  function saved() {
    resetDirty(submittedFields.current ?? undefined)
    refresh(() => action.router.refresh())
  }
  return (
    <form
      ref={formRef}
      onChange={checkDirty}
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (refreshing || action.busy || action.reload || creatingType) return
        setInvalid('')
        if (action.locked) {
          const result = await action.run('/api/intake', {})
          if (result) saved()
          return
        }
        const form = new FormData(e.currentTarget)
        let next: ReceptionSession['sources']
        try {
          next = manualReceptionSources(
            sources,
            {
              description: form.get('description'),
              attributes: questionsFor(vocabulary, itemType || null)
                .filter((q) => q.definition.slug !== 'description')
                .flatMap(({ definition: a }) => {
                  const value = String(
                    form.get(`attribute-${a.slug}`) ?? '',
                  ).trim()
                  return value
                    ? [
                        {
                          slug: a.slug,
                          definitionVersion: a.version,
                          value,
                          sourceId: crypto.randomUUID(),
                        },
                      ]
                    : []
                }),
              itemType: form.get('itemType') || undefined,
              amount: exactPrice(String(form.get('amount'))),
              reference: form.get('reference'),
              rationale: form.get('rationale'),
            },
            crypto.randomUUID(),
            crypto.randomUUID(),
            crypto.randomUUID(),
          )
        } catch {
          setInvalid(d.invalid)
          return
        }
        submittedFields.current = form
        const result = await action.run('/api/intake', {
          action: 'saveReceptionSources',
          tenantId,
          requestId: crypto.randomUUID(),
          sessionId,
          expectedRevision: revision,
          sources: next,
          internalNote: {
            id: initialNote.id,
            note: String(form.get('internal-note') ?? ''),
          },
        })
        if (result) saved()
      }}
    >
      <fieldset
        data-draft-readiness={!ready ? '' : undefined}
        disabled={!ready || action.locked || refreshing}
        className="reception-fields"
      >
        <div className="field">
          <label htmlFor="garment-description">{d.description}</label>
          <textarea
            id="garment-description"
            name="description"
            maxLength={1000}
            required={
              vocabulary.registration?.settings.descriptionRequired ?? false
            }
            defaultValue={initial?.description ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="garment-type">{typeLabels.itemType}</label>
          <select
            id="garment-type"
            name="itemType"
            value={itemType}
            disabled={creatingType}
            onChange={(e) => {
              if (e.target.value === '__create__') setCreatingType(true)
              else setItemType(e.target.value)
            }}
          >
            <option value="">{typeLabels.itemTypeNone}</option>
            {vocabulary.types
              .filter((t) => t.active || t.slug === itemType)
              .map((type) => (
                <option key={type.slug} value={type.slug}>
                  {labelOf(type, locale)}
                </option>
              ))}
            {canManageTypes && (
              <option value="__create__">{typeLabels.createType}</option>
            )}
          </select>
        </div>
        <RegistrationFields
          vocabulary={vocabulary}
          itemType={itemType || null}
          locale={locale}
          initial={Object.fromEntries(
            (initial?.attributes ?? []).map((a) => [a.slug, a.value]),
          )}
        />
        <div className="field">
          <label htmlFor="manual-internal-note">
            {typeLabels.internalNote}
          </label>
          <textarea
            id="manual-internal-note"
            name="internal-note"
            defaultValue={initialNote.note}
            maxLength={2000}
          />
          <small>{typeLabels.internalNoteHint}</small>
        </div>
        {creatingType && canManageTypes && (
          <CreateItemType
            compact
            initiallyOpen
            initialFields={vocabulary.types
              .find((t) => t.slug === itemType)
              ?.attributes.map((a) => a.slug)}
            tenantId={tenantId}
            vocabulary={vocabulary}
            lang={locale}
            disabled={!ready || action.locked || refreshing}
            d={typeLabels}
            settings={typeSettings}
            onClose={() => setCreatingType(false)}
            onSelect={(profile) => {
              setVocabulary((v) => ({
                ...v,
                types: [
                  ...v.types.filter((t) => t.slug !== profile.slug),
                  profile,
                ],
              }))
              setItemType(profile.slug)
            }}
          />
        )}
        <div className="field">
          <label htmlFor="garment-price">{d.price}</label>
          <input
            id="garment-price"
            name="amount"
            inputMode="decimal"
            required
            maxLength={9}
            defaultValue={initial?.amount ?? ''}
          />
          <small>{d.priceHelp}</small>
        </div>
        <div className="field">
          <label htmlFor="garment-reference">{d.reference}</label>
          <input
            id="garment-reference"
            name="reference"
            maxLength={200}
            required
            defaultValue={initial?.reference ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor="garment-rationale">{d.rationale}</label>
          <textarea
            id="garment-rationale"
            name="rationale"
            maxLength={500}
            required
            defaultValue={initial?.rationale ?? ''}
          />
        </div>
      </fieldset>
      <p>{d.sourceNotice}</p>
      <Button
        disabled={
          !ready || action.busy || action.reload || refreshing || creatingType
        }
      >
        {action.locked ? d.retryButton : d.saveSources}
      </Button>
      {invalid && <p role="alert">{invalid}</p>}
      <Failure action={action} d={d} />
    </form>
  )
}
export function PublishReview({
  tenantId,
  sessionId,
  revision,
  previousId,
  agreementId,
  suggestions,
  requireFieldReview = false,
  d,
}: {
  tenantId: string
  sessionId: string
  revision: number
  previousId: string | null
  agreementId: string | null
  suggestions: ReceptionSuggestions
  requireFieldReview?: boolean
  d: D
}) {
  const action = useWrite(d),
    [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState<ReceptionReviewField[]>([])
  const review = requireFieldReview
    ? reviewReceptionFacts(suggestions, selected)
    : { suggestions, complete: true }
  const fields = requireFieldReview ? receptionReviewFields(suggestions) : []
  return (
    <div>
      {fields.map((field) => (
        <label key={field} className="intake-confirm">
          <input
            type="checkbox"
            name={`review-${field}`}
            checked={selected.includes(field)}
            disabled={action.locked}
            onChange={(e) => {
              setSelected(
                e.target.checked
                  ? [...selected, field]
                  : selected.filter((f) => f !== field),
              )
              setConfirmed(false)
            }}
          />
          {field === 'price'
            ? d.confirmPrice
            : `${d.confirmFact}: ${(d.aiFields as Record<string, string | undefined>)[field] ?? field}`}
        </label>
      ))}
      <label className="intake-confirm">
        <input
          type="checkbox"
          name="review-final"
          checked={confirmed}
          disabled={action.locked}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {d.confirm}
      </label>
      <p>{d.expiry}</p>
      <Button
        disabled={
          !confirmed || !review.complete || action.busy || action.reload
        }
        onClick={async () => {
          if (!confirmed || !review.complete) return
          const result = await action.run('/api/intake', {
            action: 'publishReceptionReview',
            tenantId,
            requestId: crypto.randomUUID(),
            sessionId,
            sourceRevision: revision,
            previousReviewId: previousId,
            agreementId,
            suggestions: review.suggestions,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          })
          if (result) action.router.refresh()
        }}
      >
        {action.locked ? d.retryButton : d.publish}
      </Button>
      <Failure action={action} d={d} />
    </div>
  )
}
export function ReviewAccess({
  tenantId,
  reviewId,
  access,
  available,
  email,
  d,
}: {
  tenantId: string
  reviewId: string
  access: { id: string; enabled: boolean } | null
  available: boolean
  email: string
  d: D
}) {
  const action = useWrite(d),
    [path, setPath] = useState<string | null>(null),
    [copied, setCopied] = useState(false)
  const linkInput = useRef<HTMLInputElement>(null)
  const [copyError, setCopyError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshing, startRefresh] = useTransition()
  async function change(enabled: boolean) {
    if (action.busy || action.locked || action.reload || refreshing) return
    setPath(null)
    setCopied(false)
    setCopyError('')
    setNotice('')
    const result = await action.run('/api/reception/access', {
      tenantId,
      requestId: crypto.randomUUID(),
      reviewId,
      previousId: access?.id ?? null,
      enabled,
    })
    if (result) {
      setPath(result.path ?? null)
      setCopied(false)
      if (!enabled) setNotice(d.linkRevoked)
      startRefresh(() => action.router.refresh())
    }
  }
  return (
    <div>
      <p>
        {d.recipient}: <strong>{email || d.noEmail}</strong>
      </p>
      <p>{d.linkNotice}</p>
      <div className="row wrap">
        <Button
          disabled={
            !available ||
            !email ||
            action.busy ||
            action.locked ||
            action.reload ||
            refreshing
          }
          onClick={() => change(true)}
        >
          {access?.enabled ? d.replaceLink : d.issueLink}
        </Button>
        {access?.enabled && (
          <Button
            variant="secondary"
            disabled={
              action.busy || action.locked || action.reload || refreshing
            }
            onClick={() => change(false)}
          >
            {d.revokeLink}
          </Button>
        )}
      </div>
      {path && available && (
        <div className="field">
          <label htmlFor="seller-review-link">{d.link}</label>
          <input
            ref={linkInput}
            id="seller-review-link"
            readOnly
            value={
              typeof window === 'undefined'
                ? path
                : window.location.origin + path
            }
          />
          <Button
            variant="secondary"
            onClick={async () => {
              setCopied(false)
              setCopyError('')
              try {
                await navigator.clipboard.writeText(
                  window.location.origin + path,
                )
                setCopied(true)
              } catch {
                linkInput.current?.focus()
                linkInput.current?.select()
                setCopyError(d.copyFailed)
              }
            }}
          >
            {copied ? d.copied : d.copy}
          </Button>
          {copyError && <p role="alert">{copyError}</p>}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <Failure action={action} d={d} />
    </div>
  )
}
