'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { QuickSellerPicker } from './quick-seller-picker'
import { Camera, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { quickAiProposal } from '@/lib/intake/quick-ai-proposal'
import { quickReceiveResult } from '@/lib/intake/quick-receive-result'
import {
  labelOf,
  questionsFor,
  type AttributeVocabulary,
} from '@/lib/engine/attributes'

type Seller = { id: string; name: string; contact: string | null }
type Printer = { id: string; name: string }
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
  vocabulary,
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
  lang: string
  d: Dictionary['quickIntake']
  bagId?: string
}) {
  const router = useRouter()
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
    [done, setDone] = useState<{ reference: string; itemId: string } | null>(
      null,
    )
  // What this item type asks for, in the profile's order. Changing the type
  // changes the questions; answers to questions the new type does not ask are
  // dropped rather than sent for an item they do not describe.
  const questions = questionsFor(vocabulary, itemType).filter(
    (q) => q.definition.slug !== 'category',
  )
  const activeTypes = vocabulary.types.filter((t) => t.active)
  const running = useRef(false)
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

  async function onPhoto(file: File) {
    if (running.current || !sellerId) return
    running.current = true
    setError('')
    setStage('uploading')
    try {
      setPhotoUrl(URL.createObjectURL(file))
      let current = session
      if (!current) {
        const created = await post('/api/intake', {
          action: 'createReception',
          ...(bagId ? { bagId } : {}),
          tenantId,
          requestId: crypto.randomUUID(),
          sellerId,
        })
        current = { id: created.id, revision: 0 }
      }
      const photoId = crypto.randomUUID()
      const uploaded = await fetch(
        `/api/reception/${current.id}/photo?photo=${photoId}&tenant=${tenantId}`,
        { method: 'POST', body: file },
      )
      const upload = await uploaded.json().catch(() => ({}))
      if (!uploaded.ok) throw new Error(upload.error ?? 'PHOTO_UPLOAD_FAILED')
      await post('/api/intake', {
        action: 'saveReceptionSources',
        tenantId,
        requestId: crypto.randomUUID(),
        sessionId: current.id,
        expectedRevision: current.revision,
        sources: [upload.source],
      })
      current = { id: current.id, revision: current.revision + 1 }
      setSession(current)
      if (assistance) {
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
      fail(e)
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
      sessionId: session?.id ?? null,
      expectedRevision: session?.revision ?? 0,
      facts: cleaned,
      itemType,
      priceOre: ore,
    }
  }

  async function submit() {
    if (running.current || !sellerId) return
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
      if (current.printerId) {
        setStage('printing')
        try {
          await post('/api/print', {
            tenantId,
            requestId: crypto.randomUUID(),
            printerId: current.printerId,
            kind: 'item',
            referenceKind: 'item',
            referenceId: result.itemId,
            copies: 1,
          })
          setMessage(d.printed)
        } catch {
          setMessage(d.printFailed)
        }
      } else setMessage('')
      setDone({ reference: result.reference, itemId: result.itemId })
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
    focusNextItem.current = true
    attempt.current = null
    requestId.current = null
    setUncertain(false)
    setStale(false)
    setDone(null)
    setFacts(emptyFacts)
    setPrice('')
    setPhotoUrl(null)
    setSession(null)
    setMessage('')
    setError('')
    if (fileInput.current) fileInput.current.value = ''
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
                disabled={busy || uncertain}
                onClick={() => {
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
                <Link className="btn btn-secondary" href="/intake#new-seller">
                  {d.newSeller}
                </Link>
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
          <div className="quick-workspace">
            <div className="quick-photo-panel">
              <div className="field quick-photo-field">
                <label
                  htmlFor="quick-photo"
                  className={`quick-photo-picker${busy || session || uncertain ? ' is-disabled' : ''}`}
                >
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt={d.photo} />
                  ) : (
                    <>
                      <Camera size={32} strokeWidth={1.5} aria-hidden="true" />
                      <span>{d.addPhoto}</span>
                    </>
                  )}
                </label>
                <input
                  id="quick-photo"
                  aria-label={d.photo}
                  className="quick-photo-input"
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  disabled={busy || !!session || uncertain}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void onPhoto(file)
                  }}
                />
                <small>{assistance ? d.photoHintAi : d.photoHint}</small>
              </div>
              {(message || stage === 'uploading') && (
                <p className="quick-status" role="status">
                  {stage === 'uploading' ? d.busy : message}
                </p>
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
                  onBlur={() => {
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
              disabled={busy}
              onClick={() => void submit()}
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
          {message && <p role="status">{message}</p>}
          {/* Two actions must fit a 320px phone: wrap instead of pushing the page sideways. */}
          <div className="row wrap">
            <Button onClick={next}>{d.next}</Button>
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
