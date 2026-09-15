'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'

type Seller = { id: string; name: string; contact: string | null }
type Printer = { id: string; name: string }
type Facts = {
  description: string
  category: string
  brand: string
  size: string
  color: string
  material: string
  condition: string
}
const emptyFacts: Facts = {
  description: '',
  category: '',
  brand: '',
  size: '',
  color: '',
  material: '',
  condition: '',
}
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
  d,
}: {
  tenantId: string
  sellers: Seller[]
  printers: Printer[]
  assistance: boolean
  d: Dictionary['quickIntake']
}) {
  const [query, setQuery] = useState(''),
    [sellerId, setSellerId] = useState<string | null>(null),
    [printerId, setPrinterId] = useState(''),
    [facts, setFacts] = useState<Facts>(emptyFacts),
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
            const value = (key: keyof Facts) =>
              (s.metadata?.[key]?.value as string | undefined) ?? ''
            setFacts({
              description: value('description'),
              category: value('category'),
              brand: value('brand'),
              size: value('size'),
              color: value('color'),
              material: value('material'),
              condition: value('condition'),
            })
            if (s.price?.amount) setPrice(String(s.price.amount))
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
    if (!facts.description.trim() || !Number.isInteger(ore) || ore <= 0) {
      setError(d.fillIn)
      return
    }
    running.current = true
    setError('')
    setStage('saving')
    try {
      const cleaned = Object.fromEntries(
        Object.entries(facts)
          .map(([k, v]) => [k, v.trim()])
          .filter(([k, v]) => k === 'description' || v),
      )
      const result = await post('/api/intake/quick', {
        tenantId,
        requestId: crypto.randomUUID(),
        sellerId,
        sessionId: session?.id ?? null,
        expectedRevision: session?.revision ?? 0,
        facts: cleaned,
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
  const field = (key: keyof Facts, label: string, required = false) => (
    <div className="field" key={key}>
      <label htmlFor={`quick-${key}`}>{label}</label>
      <input
        id={`quick-${key}`}
        value={facts[key]}
        maxLength={1000}
        required={required}
        disabled={busy || !!done}
        onChange={(e) => setFacts({ ...facts, [key]: e.target.value })}
      />
    </div>
  )
  return (
    <div className="intake-grid">
      <section className="card intake-form" aria-label={d.seller}>
        <h2>{d.seller}</h2>
        {seller ? (
          <p>
            <strong>{seller.name}</strong>
            {seller.contact ? ` · ${seller.contact}` : ''}{' '}
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
          </p>
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
        <section className="card intake-form" aria-label={d.garment}>
          <h2>{d.garment}</h2>
          <div className="field">
            <label htmlFor="quick-photo">{d.photo}</label>
            <input
              id="quick-photo"
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
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" style={{ maxWidth: 240 }} />
            )}
            <small>{assistance ? d.photoHintAi : d.photoHint}</small>
          </div>
          {message && <p role="status">{message}</p>}
          {field('description', d.description, true)}
          <div className="row">
            {field('category', d.category)}
            {field('brand', d.brand)}
            {field('size', d.size)}
          </div>
          <div className="row">
            {field('color', d.color)}
            {field('material', d.material)}
            {field('condition', d.condition)}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="quick-price">{d.price}</label>
              <input
                id="quick-price"
                inputMode="decimal"
                value={price}
                disabled={busy}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
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
          <Button disabled={busy} onClick={() => void submit()}>
            {stage === 'saving'
              ? d.busy
              : stage === 'printing'
                ? d.printing
                : d.submit}
          </Button>
        </section>
      )}
      {done && (
        <section className="card intake-form" aria-label={d.done}>
          <h2>{d.done}</h2>
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
