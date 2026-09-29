'use client'
import { NewSellerLink } from '@/components/intake/new-seller-link'
import { CreateItemType } from './create-item-type'
import { useEffect, useRef, useState } from 'react'
import {
  NavigationLink as Link,
  useNavigationWarning,
} from '@/components/platform/navigation-warning'
import { useRouter } from 'next/navigation'
import { QuickSellerPicker } from './quick-seller-picker'
import { Camera, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { quickAiProposal } from '@/lib/intake/quick-ai-proposal'
import { quickReceiveResult } from '@/lib/intake/quick-receive-result'
import {
  createdReception,
  photoReferences,
  savedSources,
  uploadedPhoto,
  type PhotoSource,
} from '@/lib/intake/quick-photo-results'
import {
  labelOf,
  questionsFor,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'

type Seller = { id: string; name: string; contact: string | null }
type Printer = { id: string; name: string }
type PrintAttempt = {
  tenantId: string
  requestId: string
  printerId: string
  kind: 'item'
  referenceKind: 'item'
  referenceId: string
  copies: 1
}
/** Slug to value. Which slugs appear is decided by the item type, so a lamp
 * shows a socket where a sweater shows a size. */
type Facts = Record<string, string>
const emptyFacts: Facts = { description: '' }
const PRINTER_KEY = 'komisio-quick-printer'
/** A reply the server actually gave: its code and HTTP status. */
class RequestFailure extends Error {
  constructor(
    code: string,
    readonly status: number,
  ) {
    super(code)
  }
}
/**
 * Refusals the quick route answers with 4xx before anything is accepted for
 * this request: the engine raised inside its transaction, so the item does
 * not exist and the staff member may correct and resend. Everything else
 * (5xx, REQUEST_FAILED, unknown codes, non-JSON, network) is uncertain: the
 * item may have been accepted and only the reply was lost.
 */
const DEFINITIVE = new Set([
  'INVALID_INPUT',
  'INTAKE_PROFILE_FULL',
  'RECEPTION_NOT_FOUND',
  'RECEPTION_CHANGED',
  'RECEPTION_SESSION_SELLER',
  'AGREEMENT_REQUIRED',
  'SELLER_APPROVAL_REQUIRED',
  'CURRENCY_MISMATCH',
  'PLAN_LIMIT_ITEMS',
  'PLAN_PLUS_REQUIRED',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'TENANT_CHANGED',
  'NOT_FOUND',
])
const definitive = (e: unknown) =>
  e instanceof RequestFailure &&
  e.status >= 400 &&
  e.status < 500 &&
  DEFINITIVE.has(e.message)
/**
 * Definitive refusals that say the page's picture is stale (another window,
 * another store, a changed policy or currency). Sending the same fields again
 * repeats the refusal, so the way forward is a reload; the fields stay
 * editable because nothing was accepted.
 */
const STALE = new Set([
  'RECEPTION_CHANGED',
  'RECEPTION_NOT_FOUND',
  'RECEPTION_SESSION_SELLER',
  'TENANT_CHANGED',
  'CURRENCY_MISMATCH',
  'INTAKE_PROFILE_FULL',
])
/**
 * Photo phases. An invalid file is refused by the upload route before any
 * object is written, so the file itself may be replaced. Stale or context
 * refusals leave the visible photo unresolved: the same bytes may be retried
 * or the page reloaded. PHOTO_UPLOAD_FAILED is deliberately absent: it can
 * follow a partially stored object, so it stays uncertain.
 */
const PHOTO_INVALID = new Set([
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'INVALID_INPUT',
])
const PHOTO_STALE = new Set([
  'INVALID_INPUT',
  'SELLER_NOT_FOUND',
  'RECEPTION_NOT_FOUND',
  'RECEPTION_CHANGED',
  'RECEPTION_SOURCE_CHANGED',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'TENANT_CHANGED',
  'NOT_FOUND',
])
/** The reception the engine will hold for this garment attempt, with the
 * store, seller and bag it was started for frozen in: a retry after an await
 * must not read those anew. */
type Reception = {
  createId: string
  tenantId: string
  sellerId: string
  bagId?: string
  sessionId?: string
}
/** One chosen file with the identities its phases reuse until confirmed. */
type PhotoAttempt = {
  file: File
  previewUrl: string
  photoId: string
  saveId: string
  source?: PhotoSource
  saved?: boolean
  assisted?: boolean
}

/**
 * One screen: seller, photo, facts (filled by the assistant when the store
 * has one), price, printer. "Ready for the shelf" makes the item and queues
 * the label. The seller and printer stay selected for the next garment.
 */
export function QuickReception({
  tenantId,
  sellers,
  sellersTotal = sellers.length,
  printers,
  assistance,
  vocabulary: initialVocabulary,
  canManageTypes = false,
  lang,
  d,
  bagId,
}: {
  tenantId: string
  sellers: Seller[]
  sellersTotal?: number
  printers: Printer[]
  assistance: boolean
  vocabulary: AttributeVocabulary
  canManageTypes?: boolean
  lang: string
  d: Dictionary['quickIntake']
  bagId?: string
}) {
  const router = useRouter()
  const [createdTypes, setCreatedTypes] = useState<
    AttributeVocabulary['types']
  >([])
  const vocabulary = {
    ...initialVocabulary,
    types: [
      ...initialVocabulary.types.filter(
        (t) => !createdTypes.some((c) => c.slug === t.slug),
      ),
      ...createdTypes,
    ],
  }
  const [typeEditorOpen, setTypeEditorOpen] = useState(false)
  const [seller, setSeller] = useState<Seller | null>(
      bagId ? (sellers[0] ?? null) : null,
    ),
    [printerId, setPrinterId] = useState(''),
    [facts, setFacts] = useState<Facts>(emptyFacts),
    [itemType, setItemType] = useState<string | null>(null),
    [typeQuery, setTypeQuery] = useState(''),
    [price, setPrice] = useState(''),
    [photoUrl, setPhotoUrl] = useState<string | null>(null),
    [session, setSession] = useState<{ id: string; revision: number } | null>(
      null,
    ),
    [stage, setStage] = useState<
      'idle' | 'uploading' | 'assisting' | 'saving' | 'printing'
    >('idle'),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [done, setDone] = useState<{
      reference: string
      itemId: string
      printJobId: string | null
    } | null>(null)
  // What this item type asks for, in the profile's order. Changing the type
  // changes the questions; answers to questions the new type does not ask are
  // dropped rather than sent for an item they do not describe.
  const questions = questionsFor(vocabulary, itemType).filter(
    (q) => q.definition.slug !== 'category',
  )
  const activeTypes = vocabulary.types.filter((t) => t.active)
  const running = useRef(false)
  const itemTypeEnter = useRef(false)
  // One request id per garment attempt. It names the reception the engine
  // derives, so a corrected resend after a validation refusal reuses the same
  // (possibly already created) session instead of leaving an empty one behind.
  const requestId = useRef<string | null>(null)
  // The exact command whose reply was lost, with the printer chosen for it.
  // While it exists the next click resends it verbatim and the engine replays
  // the same item; nothing on screen may suggest that edits would apply.
  const attempt = useRef<{
    command: Record<string, unknown>
    printerId: string
  } | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [stale, setStale] = useState(false)
  const pendingPrint = useRef<PrintAttempt | null>(null)
  const printing = useRef(false)
  const [printIssue, setPrintIssue] = useState<'uncertain' | 'refused' | null>(
    null,
  )
  // Photo phases keep their identities here so a retry repeats exactly the
  // phases that were not confirmed; nothing is re-derived from the fields.
  const reception = useRef<Reception | null>(null)
  const photo = useRef<PhotoAttempt | null>(null)
  const photoWasUncertain = useRef(false)
  const [photoIssue, setPhotoIssue] = useState<
    'invalid' | 'stale' | 'uncertain' | null
  >(null)
  const [photoError, setPhotoError] = useState('')
  const photoUnresolved = photoIssue === 'stale' || photoIssue === 'uncertain'
  // A selected seller/type or remembered printer alone is not unsaved item
  // content. Type selection carries over to the next item on purpose.
  const hasUnsavedItem =
    !done &&
    (Object.values(facts).some((value) => value.length > 0) ||
      price.length > 0 ||
      photoUrl !== null ||
      uncertain ||
      photoUnresolved)
  useNavigationWarning(hasUnsavedItem ? d.leaveItem : null)
  useEffect(() => {
    if (!hasUnsavedItem) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnsavedItem])
  // A file chosen before React has taken over the server-rendered input
  // fires a change event nothing handles and is silently lost. The picker
  // opens only once the handler is attached; the first frame still matches
  // the server's.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0)
    return () => {
      clearTimeout(timer)
      // Leaving the screen with a preview still shown: release its object URL
      // (a StrictMode cleanup before any photo exists has nothing to do).
      if (photo.current) URL.revokeObjectURL(photo.current.previewUrl)
    }
  }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const itemHeading = useRef<HTMLHeadingElement>(null)
  const doneHeading = useRef<HTMLHeadingElement>(null)
  const focusNextItem = useRef(false)
  useEffect(() => {
    // Only an explicit seller selection or Next item moves the user's place.
    // Focus the heading so mobile users can choose photo or typing themselves.
    if (!focusNextItem.current || !seller || done || !itemHeading.current)
      return
    focusNextItem.current = false
    itemHeading.current.focus({ preventScroll: true })
    itemHeading.current.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [seller, done])
  useEffect(() => {
    // "Ready for the shelf" unmounts the button that had focus. Move focus to
    // the confirmation heading so completion is announced and the next Tab
    // reaches "Next item" instead of starting over from the page top.
    if (!done || !doneHeading.current) return
    doneHeading.current.focus({ preventScroll: true })
    doneHeading.current.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [done])
  const errors = d.errors as Record<string, string>
  useEffect(() => {
    // The remembered printer is a per-browser convenience; it is applied
    // after hydration so the server and client render the same first frame.
    let saved: string | null = null
    try {
      saved = localStorage.getItem(PRINTER_KEY)
    } catch {
      /* Storage unavailable: no remembered printer. */
    }
    if (!saved || !printers.some((p) => p.id === saved)) return
    const remembered = saved
    const timer = setTimeout(() => setPrinterId(remembered), 0)
    return () => clearTimeout(timer)
  }, [printers])
  const sellerId = seller?.id ?? null
  const post = async (path: string, body: object) => {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok)
      throw new RequestFailure(
        typeof data.error === 'string' ? data.error : 'REQUEST_FAILED',
        r.status,
      )
    return data
  }
  const fail = (e: unknown) => {
    const code = e instanceof Error ? e.message : ''
    setError(errors[code] ?? d.failed)
  }

  async function runPrint() {
    const command = pendingPrint.current
    if (!command || printing.current || printIssue === 'refused') return
    printing.current = true
    setStage('printing')
    setPrintIssue(null)
    setMessage('')
    try {
      const result = await post('/api/print', command)
      if (result?.ok !== true || result?.id !== command.requestId)
        throw new Error('UNCONFIRMED_PRINT')
      pendingPrint.current = null
      setMessage(d.printed)
      doneHeading.current?.focus({ preventScroll: true })
    } catch (error) {
      setPrintIssue(
        error instanceof RequestFailure &&
          error.status >= 400 &&
          error.status < 500
          ? 'refused'
          : 'uncertain',
      )
      setMessage(d.printFailed)
    } finally {
      printing.current = false
      setStage('idle')
    }
  }

  function dropPhoto() {
    if (photo.current) URL.revokeObjectURL(photo.current.previewUrl)
    photo.current = null
    setPhotoUrl(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  /** A newly chosen file: fresh photo identities on this attempt's reception. */
  async function onPhoto(file: File) {
    // An unresolved photo is never replaced by choosing another file; the
    // input is disabled then, and this guard covers a queued change event.
    if (running.current || !sellerId || session || photoUnresolved) return
    if (photo.current) URL.revokeObjectURL(photo.current.previewUrl)
    photo.current = {
      file,
      previewUrl: URL.createObjectURL(file),
      photoId: crypto.randomUUID(),
      saveId: crypto.randomUUID(),
    }
    reception.current ??= {
      createId: crypto.randomUUID(),
      tenantId,
      sellerId,
      ...(bagId ? { bagId } : {}),
    }
    setPhotoUrl(photo.current.previewUrl)
    await runPhoto()
  }

  /**
   * Create the reception, upload the photo, save it as a source, then ask the
   * assistant once. Each phase is skipped when already confirmed and repeated
   * with the same identity otherwise, so a lost reply is retried exactly: the
   * engine replays the create and the save by id, storage accepts the same
   * bytes for the same object.
   */
  async function runPhoto() {
    const p = photo.current,
      r = reception.current
    if (running.current || !sellerId || !p || !r) return
    running.current = true
    setPhotoError('')
    setPhotoIssue(null)
    setStage('uploading')
    let phase: 'create' | 'upload' | 'save' = 'create'
    try {
      if (!r.sessionId) {
        const created = createdReception.parse(
          await post('/api/intake', {
            action: 'createReception',
            ...(r.bagId ? { bagId: r.bagId } : {}),
            tenantId: r.tenantId,
            requestId: r.createId,
            sellerId: r.sellerId,
          }),
        )
        // The engine names the reception by the request id it was given.
        if (created.id !== r.createId) throw new Error('CREATE_MISMATCH')
        r.sessionId = created.id
        // A phase confirmed with its exact identity settles whatever was
        // uncertain about it; the next phase starts with a clean slate.
        photoWasUncertain.current = false
      }
      phase = 'upload'
      if (!p.source) {
        const uploaded = await fetch(
          `/api/reception/${r.sessionId}/photo?photo=${p.photoId}&tenant=${r.tenantId}`,
          { method: 'POST', body: p.file },
        )
        const body = await uploaded.json().catch(() => ({}))
        if (!uploaded.ok)
          throw new RequestFailure(
            typeof body.error === 'string' ? body.error : 'PHOTO_UPLOAD_FAILED',
            uploaded.status,
          )
        const upload = uploadedPhoto.parse(body)
        // Only this photo of this reception may travel into the source save.
        if (
          upload.source.id !== p.photoId ||
          !photoReferences(r.tenantId, r.sessionId, p.photoId).includes(
            upload.source.reference,
          )
        )
          throw new Error('PHOTO_MISMATCH')
        p.source = upload.source
        photoWasUncertain.current = false
      }
      phase = 'save'
      if (!p.saved) {
        const saved = savedSources.parse(
          await post('/api/intake', {
            action: 'saveReceptionSources',
            tenantId: r.tenantId,
            requestId: p.saveId,
            sessionId: r.sessionId,
            expectedRevision: 0,
            sources: [p.source],
          }),
        )
        if (saved.id !== p.saveId) throw new Error('SAVE_MISMATCH')
        p.saved = true
        photoWasUncertain.current = false
      }
      const current = { id: r.sessionId, revision: 1 }
      setSession(current)
      // The assistant is asked once per saved photo, never again on a rerun.
      if (assistance && !p.assisted) {
        p.assisted = true
        setStage('assisting')
        setMessage(d.aiWorking)
        try {
          const result = await post('/api/reception/assistance', {
            tenantId,
            sessionId: current.id,
            requestId: crypto.randomUUID(),
            revision: current.revision,
          })
          const s = result?.proposal?.suggestions
          if (result?.status === 'proposed' && s) {
            const filled = quickAiProposal(s)
            setFacts(filled.facts)
            setItemType(filled.itemType)
            const suggestedType = activeTypes.find(
              (t) => t.slug === filled.itemType,
            )
            setTypeQuery(suggestedType ? labelOf(suggestedType, lang) : '')
            setPrice(filled.price)
            setMessage(d.aiDone)
          } else setMessage(d.aiUnavailable)
        } catch {
          setMessage(d.aiFailed)
        }
      } else setMessage('')
    } catch (e) {
      const code = e instanceof RequestFailure ? e.message : ''
      const refused =
        e instanceof RequestFailure && e.status >= 400 && e.status < 500
      const known =
        refused && (PHOTO_INVALID.has(code) || PHOTO_STALE.has(code))
      if (known && photoWasUncertain.current) {
        // A refusal now is no proof about the earlier unanswered phase; the
        // same identities stay and the refusal is shown as detail only.
        setPhotoIssue('uncertain')
        setPhotoError(`${d.photoUncertain} ${errors[code] ?? ''}`.trim())
      } else if (phase === 'upload' && refused && PHOTO_INVALID.has(code)) {
        // A first, answered refusal of the bytes: nothing was written for
        // this photo id, so the file is replaced on the same reception.
        dropPhoto()
        setPhotoIssue('invalid')
        setPhotoError(errors[code] ?? errors.REQUEST_FAILED)
      } else if (known) {
        setPhotoIssue('stale')
        setPhotoError(errors[code] ?? errors.REQUEST_FAILED)
      } else {
        photoWasUncertain.current = true
        setPhotoIssue('uncertain')
        setPhotoError(d.photoUncertain)
      }
    } finally {
      running.current = false
      setStage('idle')
    }
  }

  function buildCommand() {
    const ore = Math.round(Number(price.replace(',', '.')) * 100)
    if (!(facts.description ?? '').trim() || !Number.isInteger(ore) || ore <= 0)
      return null
    const asked = new Set(questions.map((q) => q.definition.slug))
    const cleaned = Object.fromEntries(
      Object.entries(facts)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(
          ([k, v]) =>
            k !== 'category' &&
            (k === 'description' || (v !== '' && (asked.has(k) || !itemType))),
        ),
    )
    requestId.current ??= crypto.randomUUID()
    return {
      ...(bagId ? { bagId } : {}),
      tenantId,
      requestId: requestId.current,
      sellerId,
      // A reception created for a photo that was then replaced is reused
      // rather than left empty beside a derived one.
      sessionId: session?.id ?? reception.current?.sessionId ?? null,
      expectedRevision: session?.revision ?? 0,
      facts: cleaned,
      itemType,
      priceOre: ore,
    }
  }

  async function submit() {
    if (running.current || !sellerId || photoUnresolved || typeEditorOpen)
      return
    // A lost reply is retried with the very command that was sent, never with
    // whatever the fields hold now.
    let current = attempt.current
    if (!current) {
      const command = buildCommand()
      if (!command) {
        setError(d.fillIn)
        return
      }
      current = { command, printerId }
      attempt.current = current
    }
    running.current = true
    setError('')
    setStage('saving')
    try {
      // A 200 is only a confirmation when it carries the item: a truncated or
      // malformed body leaves the outcome as unknown as a lost reply.
      const result = quickReceiveResult.parse(
        await post('/api/intake/quick', current.command),
      )
      attempt.current = null
      setUncertain(false)
      setStale(false)
      const printJobId = current.printerId ? crypto.randomUUID() : null
      setDone({
        reference: result.reference,
        itemId: result.itemId,
        printJobId,
      })
      if (printJobId) {
        pendingPrint.current = {
          tenantId,
          requestId: printJobId,
          printerId: current.printerId,
          kind: 'item',
          referenceKind: 'item',
          referenceId: result.itemId,
          copies: 1,
        }
        await runPrint()
      } else setMessage('')
      if (bagId) {
        // A saved item sorts first; keep the confirmation visible while refreshing that page.
        const url = new URL(window.location.href)
        if (url.searchParams.has('itemPage')) {
          url.searchParams.delete('itemPage')
          window.history.replaceState(
            null,
            '',
            url.pathname + url.search + url.hash,
          )
        }
        router.refresh()
      }
    } catch (e) {
      if (definitive(e) && !uncertain) {
        // Nothing was accepted for this request: the fields may be corrected
        // and sent again under the same request id. A stale picture also gets
        // the reload the message asks for.
        attempt.current = null
        setStale(STALE.has((e as RequestFailure).message))
        fail(e)
      } else if (definitive(e)) {
        // A refusal now does not prove the earlier, unanswered attempt did not
        // go through. Keep the attempt frozen with the uncertainty stated
        // first; the refusal is detail. Retry and reload stay available.
        const detail = errors[(e as RequestFailure).message]
        setError(detail ? `${d.uncertain} ${detail}` : d.uncertain)
      } else {
        setUncertain(true)
        setError(d.uncertain)
      }
    } finally {
      running.current = false
      setStage('idle')
    }
  }

  function next() {
    if (running.current || printing.current) return
    focusNextItem.current = true
    attempt.current = null
    requestId.current = null
    pendingPrint.current = null
    setPrintIssue(null)
    setUncertain(false)
    setStale(false)
    setDone(null)
    setFacts(emptyFacts)
    setPrice('')
    dropPhoto()
    reception.current = null
    photoWasUncertain.current = false
    setPhotoIssue(null)
    setPhotoError('')
    setSession(null)
    setMessage('')
    setError('')
  }

  const busy = stage !== 'idle'
  // One input per question the item type asks, shaped by the definition: a
  // number carries its unit, a choice offers its values by their stable ids,
  // and free text stays free text.
  const question = (definition: AttributeVocabulary['definitions'][number]) => {
    const key = definition.slug,
      id = `quick-${key}`,
      label = labelOf(definition, lang),
      set = (value: string) => setFacts({ ...facts, [key]: value })
    return (
      <div
        className={`field${key === 'description' ? ' quick-description' : ''}`}
        key={key}
      >
        <label htmlFor={id}>
          {label}
          {definition.unit ? ` (${definition.unit})` : ''}
        </label>
        {definition.data_type === 'choice' ? (
          <select
            id={id}
            value={facts[key] ?? ''}
            required={key === 'description'}
            disabled={busy || !!done || uncertain}
            onChange={(e) => set(e.target.value)}
          >
            <option value="">{d.chooseValue}</option>
            {definition.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {labelOf({ slug: choice.id, labels: choice.labels }, lang)}
              </option>
            ))}
          </select>
        ) : definition.data_type === 'boolean' ? (
          <input
            id={id}
            type="checkbox"
            checked={facts[key] === 'true'}
            disabled={busy || !!done || uncertain}
            onChange={(e) => set(e.target.checked ? 'true' : '')}
          />
        ) : key === 'description' ? (
          <textarea
            id={id}
            value={facts[key] ?? ''}
            rows={3}
            maxLength={1000}
            required
            disabled={busy || !!done || uncertain}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            id={id}
            value={facts[key] ?? ''}
            inputMode={definition.data_type === 'number' ? 'decimal' : 'text'}
            maxLength={1000}
            required={key === 'description'}
            disabled={busy || !!done || uncertain}
            onChange={(e) => set(e.target.value)}
          />
        )}
      </div>
    )
  }
  return (
    <div className={`quick-reception${bagId ? ' bag-quick-reception' : ''}`}>
      <span className="sr-only" role="status" aria-live="polite">
        {stage === 'uploading' ? d.busy : message}
      </span>
      {!bagId && (
        <section
          className={`card intake-form quick-seller${seller ? ' is-selected' : ''}`}
          aria-label={d.seller}
        >
          <h2>
            <span className="quick-step" aria-hidden="true">
              {seller ? <Check size={16} /> : '1'}
            </span>
            {d.seller}
          </h2>
          {seller ? (
            <div className="quick-seller-selected">
              <div>
                <strong>{seller.name}</strong>
                {seller.contact && <small>{seller.contact}</small>}
              </div>
              <button
                type="button"
                className="text-link"
                disabled={busy || uncertain || photoUnresolved}
                onClick={() => {
                  // Switching sellers discards the attempt; not while a
                  // photo or a submit is unresolved.
                  if (busy || uncertain || photoUnresolved) return
                  if (
                    hasUnsavedItem &&
                    !window.confirm(d.discardForSellerChange)
                  )
                    return
                  setSeller(null)
                  next()
                }}
              >
                {d.changeSeller}
              </button>
            </div>
          ) : (
            <>
              <QuickSellerPicker
                tenantId={tenantId}
                sellers={sellers}
                total={sellersTotal}
                onSelect={(selected) => {
                  focusNextItem.current = true
                  setSeller(selected)
                }}
                d={d}
              />
              <p>
                <NewSellerLink className="btn btn-secondary">
                  {d.newSeller}
                </NewSellerLink>
              </p>
            </>
          )}
        </section>
      )}
      {seller && !done && (
        <section
          className="card intake-form quick-item"
          aria-label={d.garment}
          aria-busy={busy}
        >
          <h2
            ref={itemHeading}
            tabIndex={-1}
            style={{ scrollMarginTop: '1rem' }}
          >
            {!bagId && (
              <span className="quick-step" aria-hidden="true">
                2
              </span>
            )}
            {d.garment}
          </h2>
          <form
            className="quick-item-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <div className="quick-workspace">
              <div className="quick-photo-panel">
                <div className="field quick-photo-field">
                  <label
                    htmlFor="quick-photo"
                    className={`quick-photo-picker${!ready || busy || session || uncertain || photoUnresolved ? ' is-disabled' : ''}${photoUnresolved ? ' is-uncertain' : ''}`}
                  >
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt={d.photo} />
                    ) : (
                      <>
                        <Camera
                          size={32}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                        <span>{d.addPhoto}</span>
                      </>
                    )}
                  </label>
                  <input
                    id="quick-photo"
                    className="quick-photo-input"
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    disabled={
                      !ready ||
                      busy ||
                      !!session ||
                      uncertain ||
                      photoUnresolved
                    }
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void onPhoto(file)
                    }}
                  />
                  <small>{assistance ? d.photoHintAi : d.photoHint}</small>
                </div>
                {(message || stage === 'uploading') && (
                  <p className="quick-status">
                    {stage === 'uploading' ? d.busy : message}
                  </p>
                )}
                {photoError && (
                  <p role="alert" className="error quick-photo-alert">
                    {photoError}
                  </p>
                )}
                {photoUnresolved && (
                  // Recovery sits next to the photo it concerns; two actions wrap on a 320px phone.
                  <div className="row wrap">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void runPhoto()}
                    >
                      {d.retry}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => window.location.reload()}
                    >
                      {d.reload}
                    </Button>
                  </div>
                )}
              </div>
              <div className="quick-facts">
                <div className="field">
                  <label htmlFor="quick-item-type">{d.itemType}</label>
                  <input
                    id="quick-item-type"
                    list="quick-item-types"
                    autoComplete="off"
                    placeholder={d.itemTypeNone}
                    value={typeQuery}
                    disabled={busy || !!done || uncertain}
                    onChange={(e) => {
                      const value = e.target.value
                      setTypeQuery(value)
                      const match = activeTypes.find(
                        (t) =>
                          labelOf(t, lang).toLocaleLowerCase(lang) ===
                          value.trim().toLocaleLowerCase(lang),
                      )
                      setItemType(match?.slug ?? null)
                    }}
                    onKeyDown={(event) => {
                      itemTypeEnter.current = event.key === 'Enter'
                    }}
                    onKeyUp={() => {
                      itemTypeEnter.current = false
                    }}
                    onBlur={() => {
                      itemTypeEnter.current = false
                      const selected = activeTypes.find(
                        (t) => t.slug === itemType,
                      )
                      setTypeQuery(selected ? labelOf(selected, lang) : '')
                    }}
                  />
                  <datalist id="quick-item-types">
                    {activeTypes.map((t) => (
                      <option key={t.slug} value={labelOf(t, lang)} />
                    ))}
                  </datalist>
                  {canManageTypes && (
                    <CreateItemType
                      tenantId={tenantId}
                      vocabulary={vocabulary}
                      selected={itemType}
                      lang={lang}
                      d={d}
                      disabled={busy || uncertain || photoUnresolved}
                      onOpenChange={setTypeEditorOpen}
                      onSelect={(profile) => {
                        setCreatedTypes((types) => [
                          ...types.filter((t) => t.slug !== profile.slug),
                          profile,
                        ])
                        setItemType(profile.slug)
                        setTypeQuery(labelOf(profile, lang))
                        requestAnimationFrame(() =>
                          document.getElementById('quick-item-type')?.focus(),
                        )
                      }}
                    />
                  )}
                </div>
                <div className="quick-fields">
                  {questions.map((q) => question(q.definition))}
                </div>
              </div>
            </div>
            <div className="quick-finish">
              <div className="field">
                <label htmlFor="quick-price">{d.price}</label>
                <input
                  id="quick-price"
                  required
                  inputMode="decimal"
                  value={price}
                  disabled={busy || uncertain}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              {printers.length > 0 && (
                <div className="field">
                  <label htmlFor="quick-printer">{d.printer}</label>
                  <select
                    id="quick-printer"
                    value={printerId}
                    disabled={busy || uncertain}
                    onChange={(e) => {
                      setPrinterId(e.target.value)
                      try {
                        localStorage.setItem(PRINTER_KEY, e.target.value)
                      } catch {
                        /* Not remembered. */
                      }
                    }}
                  >
                    <option value="">{d.noPrinter}</option>
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                // A visible photo whose save is unresolved must not become a
                // photoless item.
                disabled={busy || photoUnresolved || typeEditorOpen}
                type="submit"
                onClick={(event) => {
                  // Suppress only the implicit click from Enter in the type
                  // list. Explicit pointer or assistive activations still work.
                  if (itemTypeEnter.current && event.detail === 0)
                    event.preventDefault()
                  itemTypeEnter.current = false
                }}
                className="quick-submit"
              >
                {stage === 'saving'
                  ? d.busy
                  : stage === 'printing'
                    ? d.printing
                    : uncertain
                      ? d.retry
                      : d.submit}
              </Button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
                {error === errors.AGREEMENT_REQUIRED && (
                  <>
                    {' '}
                    <Link
                      className="text-link"
                      href={`/intake/sellers/${seller.id}`}
                    >
                      {d.recordAgreement}
                    </Link>
                  </>
                )}
              </p>
            )}
            {(uncertain || stale) && (
              <div className="row wrap">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => window.location.reload()}
                >
                  {d.reload}
                </Button>
              </div>
            )}
          </form>
        </section>
      )}
      {done && (
        <section className="card intake-form quick-done" aria-label={d.done}>
          <h2
            ref={doneHeading}
            tabIndex={-1}
            style={{ scrollMarginTop: '1rem' }}
          >
            <Check aria-hidden="true" />
            {d.done}
          </h2>
          <p>
            <strong>{done.reference}</strong> · {facts.description}
          </p>
          {message && <p role={printIssue ? 'alert' : 'status'}>{message}</p>}
          {(printIssue || stage === 'printing') && (
            <div className="row wrap">
              {printIssue !== 'refused' && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void runPrint()}
                >
                  {busy ? d.busy : d.retryPrint}
                </Button>
              )}
              {printIssue === 'refused' && (
                <Button
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  {d.reload}
                </Button>
              )}
              <Link
                className="btn btn-secondary"
                href={`/settings?tab=printing&job=${done.printJobId}#selected-print-job`}
              >
                {d.openPrintQueue}
              </Link>
            </div>
          )}
          {/* Two actions must fit a 320px phone: wrap instead of pushing the page sideways. */}
          <div className="row wrap">
            <Button onClick={next} disabled={busy}>
              {d.next}
            </Button>
            <Link
              className="btn btn-secondary"
              href={`/intake/items/${done.itemId}`}
            >
              {d.openItem}
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
