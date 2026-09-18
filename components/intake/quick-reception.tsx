'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import { quickAiProposal } from '@/lib/intake/quick-ai-proposal'
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

/**
 * One screen: seller, photo, facts (filled by the assistant when the store
 * has one), price, printer. "Ready for the shelf" makes the item and queues
 * the label. The seller and printer stay selected for the next garment.
 */
export function QuickReception({
  tenantId,
  sellers,
  printers,
  assistance,
  vocabulary,
  lang,
  d,
}: {
  tenantId: string
  sellers: Seller[]
  printers: Printer[]
  assistance: boolean
  vocabulary: AttributeVocabulary
  lang: string
  d: Dictionary['quickIntake']
}) {
  const [query, setQuery] = useState(''),
    [sellerId, setSellerId] = useState<string | null>(null),
    [printerId, setPrinterId] = useState(''),
    [facts, setFacts] = useState<Facts>(emptyFacts),
    [itemType, setItemType] = useState<string | null>(null),
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
  const questions = questionsFor(vocabulary, itemType)
  const running = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
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
  const seller = sellers.find((s) => s.id === sellerId) ?? null
  const shown = sellers
    .filter((s) => {
      const q = query.trim().toLowerCase()
      return (
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.contact ?? '').toLowerCase().includes(q)
      )
    })
    .slice(0, 12)
  const post = async (path: string, body: object) => {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error ?? 'REQUEST_FAILED')
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

  async function submit() {
    if (running.current || !sellerId) return
    const ore = Math.round(Number(price.replace(',', '.')) * 100)
    if (
      !(facts.description ?? '').trim() ||
      !Number.isInteger(ore) ||
      ore <= 0
    ) {
      setError(d.fillIn)
      return
    }
    running.current = true
    setError('')
    setStage('saving')
    try {
      const asked = new Set(questions.map((q) => q.definition.slug))
      const cleaned = Object.fromEntries(
        Object.entries(facts)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(
            ([k, v]) =>
              k === 'description' || (v !== '' && (asked.has(k) || !itemType)),
          ),
      )
      const result = await post('/api/intake/quick', {
        tenantId,
        requestId: crypto.randomUUID(),
        sellerId,
        sessionId: session?.id ?? null,
        expectedRevision: session?.revision ?? 0,
        facts: cleaned,
        itemType,
        priceOre: ore,
      })
      if (printerId) {
        setStage('printing')
        try {
          await post('/api/print', {
            tenantId,
            requestId: crypto.randomUUID(),
            printerId,
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
    } catch (e) {
      fail(e)
    } finally {
      running.current = false
      setStage('idle')
    }
  }

  function next() {
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
            disabled={busy || !!done}
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
            disabled={busy || !!done}
            onChange={(e) => set(e.target.checked ? 'true' : '')}
          />
        ) : key === 'description' ? (
          <textarea
            id={id}
            value={facts[key] ?? ''}
            rows={3}
            maxLength={1000}
            required
            disabled={busy || !!done}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            id={id}
            value={facts[key] ?? ''}
            inputMode={definition.data_type === 'number' ? 'decimal' : 'text'}
            maxLength={1000}
            required={key === 'description'}
            disabled={busy || !!done}
            onChange={(e) => set(e.target.value)}
          />
        )}
      </div>
    )
  }
  return (
    <div className="quick-reception">
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
              disabled={busy}
              onClick={() => {
                setSellerId(null)
                next()
              }}
            >
              {d.changeSeller}
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="quick-seller-search">{d.searchSeller}</label>
              <input
                id="quick-seller-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <ul className="intake-list">
              {shown.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="intake-seller"
                    onClick={() => setSellerId(s.id)}
                  >
                    <strong>{s.name}</strong>
                    <small>{s.contact ?? ''}</small>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li>{d.noSeller}</li>}
            </ul>
            <p>
              <Link className="text-link" href="/intake">
                {d.newSeller}
              </Link>
            </p>
          </>
        )}
      </section>
      {seller && !done && (
        <section
          className="card intake-form quick-item"
          aria-label={d.garment}
          aria-busy={busy}
        >
          <h2>
            <span className="quick-step" aria-hidden="true">
              2
            </span>
            {d.garment}
          </h2>
          <div className="quick-workspace">
            <div className="quick-photo-panel">
              <div className="field quick-photo-field">
                <label
                  htmlFor="quick-photo"
                  className={`quick-photo-picker${busy || session ? ' is-disabled' : ''}`}
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
                  disabled={busy || !!session}
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
                <select
                  id="quick-item-type"
                  value={itemType ?? ''}
                  disabled={busy || !!done}
                  onChange={(e) => setItemType(e.target.value || null)}
                >
                  <option value="">{d.itemTypeNone}</option>
                  {vocabulary.types
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {labelOf(t, lang)}
                      </option>
                    ))}
                </select>
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
                disabled={busy}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            {printers.length > 0 && (
              <div className="field">
                <label htmlFor="quick-printer">{d.printer}</label>
                <select
                  id="quick-printer"
                  value={printerId}
                  disabled={busy}
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
        </section>
      )}
      {done && (
        <section className="card intake-form quick-done" aria-label={d.done}>
          <h2>
            <Check aria-hidden="true" />
            {d.done}
          </h2>
          <p>
            <strong>{done.reference}</strong> · {facts.description}
          </p>
          {message && <p role="status">{message}</p>}
          <div className="row">
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
