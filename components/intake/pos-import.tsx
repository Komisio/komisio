'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Check, SkipForward } from 'lucide-react'
import { z } from 'zod'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { QuickSellerPicker } from './quick-seller-picker'
import type { SellerChoice } from '@/lib/intake/seller-search'
import {
  posPage,
  posChoice,
  posResult,
  canImportPosProduct,
  type PosChoice,
  type PosCommand,
  type PosProvider,
  type PosReviewRow,
} from '@/lib/pos-import'
import { formatMoney } from '@/lib/engine/money'

async function call(input: PosCommand) {
  const r = await fetch('/api/import/pos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json()
  if (!r.ok)
    throw new Error(
      typeof data.error === 'string' ? data.error : 'REQUEST_FAILED',
    )
  return data
}
type Props = {
  tenantId: string
  currency: string
  d: Dictionary['posImport']
  quick: Dictionary['quickIntake']
  leaveUnsaved: string
  sellers: SellerChoice[]
  sellerCount: number
}
export function PosImport(props: Props) {
  const { tenantId, d } = props
  const [provider, setProvider] = useState<PosProvider>('paypal')
  const [rows, setRows] = useState<PosReviewRow[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [account, setAccount] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [completed, setCompleted] = useState<PosChoice | null>(null)
  const running = useRef(false)
  useUnsavedChanges(editing ? props.leaveUnsaved : null)
  async function load(more: boolean) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const data = posPage.parse(
        await call({
          action: 'list',
          tenantId,
          provider,
          cursor: more ? next : null,
        }),
      )
      if (more && data.account !== account)
        throw new Error('POS_CONNECTION_CHANGED')
      setRows((old) =>
        more
          ? [
              ...old,
              ...data.rows.filter(
                (r) =>
                  !old.some((x) => x.product.variantId === r.product.variantId),
              ),
            ]
          : data.rows,
      )
      setNext(data.next)
      setAccount(data.account)
      setLoaded(true)
      if (!more) {
        setPage(0)
        setSkipped(new Set())
        setEditing(null)
      }
    } catch (e) {
      setError(errorText(e, d))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const visible = rows.filter(
    (r) =>
      (filter === 'all' ||
        (filter === 'linked'
          ? !!r.linked
          : !r.linked && !skipped.has(r.product.variantId))) &&
      [r.product.title, r.product.sku, r.product.barcode].some((v) =>
        v?.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
  )
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 25) - 1),
  )
  const pending = rows.filter(
    (r) => !r.linked && !skipped.has(r.product.variantId),
  ).length
  return (
    <section className="pos-import">
      <div className="pos-import-toolbar pos-import-source">
        <div className="field">
          <label htmlFor="pos-provider">{d.system}</label>
          <select
            id="pos-provider"
            value={provider}
            disabled={busy || !!editing}
            onChange={(e) => {
              setProvider(e.target.value as PosProvider)
              setRows([])
              setLoaded(false)
              setNext(null)
              setAccount('')
              setError('')
              setCompleted(null)
            }}
          >
            <option value="paypal">PayPal POS</option>
            <option value="shopify">Shopify POS</option>
          </select>
        </div>
        <Button disabled={busy || !!editing} onClick={() => load(false)}>
          {busy ? d.loading : loaded ? d.refresh : d.load}
        </Button>
        <Link href="/intake/integrations">{d.connections}</Link>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {completed && (
        <p role="status">
          {d.linked}:{' '}
          <Link href={`/intake/items/${completed.id}`}>{completed.title}</Link>
        </p>
      )}
      {loaded && (
        <>
          <div className="pos-import-summary" role="status">
            <span>{d.count.replace('{count}', String(rows.length))}</span>
            <span>{d.pendingCount.replace('{count}', String(pending))}</span>
            <small>{account}</small>
          </div>
          <div className="pos-import-toolbar">
            <div className="field pos-import-search">
              <label className="sr-only" htmlFor="pos-search">
                {d.search}
              </label>
              <input
                id="pos-search"
                type="search"
                placeholder={d.search}
                value={query}
                disabled={!!editing}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(0)
                }}
              />
            </div>
            <label className="sr-only" htmlFor="pos-filter">
              {d.status}
            </label>
            <select
              id="pos-filter"
              value={filter}
              disabled={!!editing}
              onChange={(e) => {
                setFilter(e.target.value)
                setPage(0)
              }}
            >
              <option value="pending">{d.pending}</option>
              <option value="all">{d.all}</option>
              <option value="linked">{d.linked}</option>
            </select>
          </div>
          <div
            className="pos-import-table"
            tabIndex={0}
            role="region"
            aria-label={d.products}
          >
            <table>
              <thead>
                <tr>
                  <th>{d.product}</th>
                  <th>{d.barcode}</th>
                  <th>{d.price}</th>
                  <th>{d.quantity}</th>
                  <th>{d.status}</th>
                  <th>
                    <span className="sr-only">{d.review}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible
                  .slice(currentPage * 25, currentPage * 25 + 25)
                  .map((row) => {
                    const id = row.product.variantId,
                      expanded = editing === id
                    return (
                      <PosRow
                        key={id}
                        {...props}
                        row={row}
                        expanded={expanded}
                        skipped={skipped.has(id)}
                        disabled={busy || (!!editing && !expanded)}
                        onToggle={() => setEditing(expanded ? null : id)}
                        onSkip={() => {
                          setSkipped((s) => new Set(s).add(id))
                          setEditing(null)
                        }}
                        onDone={(item) => {
                          setCompleted(item)
                          setRows((old) =>
                            old.map((r) =>
                              r.product.variantId === id
                                ? { ...r, linked: item }
                                : r,
                            ),
                          )
                          setEditing(null)
                        }}
                      />
                    )
                  })}
              </tbody>
            </table>
          </div>
          {!visible.length && <p>{d.empty}</p>}
          <div className="pos-import-footer">
            <Button
              variant="secondary"
              disabled={currentPage === 0 || !!editing}
              onClick={() => setPage(currentPage - 1)}
            >
              {d.previous}
            </Button>
            <span>
              {currentPage + 1} / {Math.max(1, Math.ceil(visible.length / 25))}
            </span>
            <Button
              variant="secondary"
              disabled={(currentPage + 1) * 25 >= visible.length || !!editing}
              onClick={() => setPage(currentPage + 1)}
            >
              {d.next}
            </Button>
            {next && (
              <Button
                variant="secondary"
                disabled={busy || !!editing}
                onClick={() => load(true)}
              >
                {busy ? d.loading : d.loadMore}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
function errorText(e: unknown, d: Dictionary['posImport']) {
  const code = e instanceof Error ? e.message : ''
  return (d.errors as Record<string, string>)[code] ?? d.errors.REQUEST_FAILED
}
function PosRow(
  props: Props & {
    row: PosReviewRow
    expanded: boolean
    skipped: boolean
    disabled: boolean
    onToggle: () => void
    onSkip: () => void
    onDone: (item: PosChoice) => void
  },
) {
  const { row, d } = props
  const [locked, setLocked] = useState(false)
  const supported = canImportPosProduct(row.product, props.currency)
  return (
    <>
      <tr>
        <td>
          <strong>{row.product.title}</strong>
          {row.product.sku && <small>{row.product.sku}</small>}
        </td>
        <td>{row.product.barcode || '—'}</td>
        <td className="pos-import-number">
          {row.product.priceOre === null
            ? '—'
            : formatMoney(
                row.product.priceOre,
                row.product.currency ?? props.currency,
              )}
        </td>
        <td>{row.product.quantity ?? d.unknown}</td>
        <td>
          {row.linked ? (
            <Link href={`/intake/items/${row.linked.id}`}>
              <Check size={15} aria-hidden="true" /> {d.linked}
            </Link>
          ) : props.skipped ? (
            d.skipped
          ) : !supported ? (
            d.needsDetails
          ) : row.suggestions.length ? (
            d.matchFound
          ) : (
            d.pending
          )}
        </td>
        <td>
          <button
            className="text-link"
            disabled={props.disabled || locked || !!row.linked}
            aria-expanded={props.expanded}
            onClick={props.onToggle}
          >
            {d.review}
            {props.expanded ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>
        </td>
      </tr>
      {props.expanded && (
        <tr>
          <td colSpan={6}>
            <RowEditor {...props} supported={supported} onLock={setLocked} />
          </td>
        </tr>
      )}
    </>
  )
}
function RowEditor(
  props: Props & {
    onLock: (locked: boolean) => void
    row: PosReviewRow
    supported: boolean
    onToggle: () => void
    onSkip: () => void
    onDone: (item: PosChoice) => void
  },
) {
  const { tenantId, row, d } = props
  const [mode, setMode] = useState<'create' | 'link'>(
    row.suggestions.length ? 'link' : 'create',
  )
  const [seller, setSeller] = useState<SellerChoice | null>(null)
  const [item, setItem] = useState<PosChoice | null>(null)
  const [context, setContext] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [choices, setChoices] = useState(row.suggestions)
  const [received, setReceived] = useState(false)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const request = useRef<Extract<PosCommand, { action: 'commit' }> | null>(null)
  const running = useRef(false)
  const onLock = props.onLock
  useEffect(() => {
    onLock(busy || uncertain)
    return () => onLock(false)
  }, [busy, uncertain, onLock])
  async function chooseSeller(s: SellerChoice) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setContext(null)
    setSeller(s)
    setError('')
    try {
      const r = z.object({ context: z.string() }).parse(
        await call({
          action: 'prepare',
          tenantId,
          token: row.token,
          sellerId: s.id,
        }),
      )
      setContext(r.context)
    } catch (e) {
      setError(errorText(e, d))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  async function search() {
    if (running.current || !query.trim()) return
    running.current = true
    setBusy(true)
    setError('')
    setItem(null)
    try {
      setChoices(
        z
          .object({ items: z.array(posChoice) })
          .parse(await call({ action: 'search', tenantId, query })).items,
      )
    } catch (e) {
      setError(errorText(e, d))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  async function commit() {
    if (running.current) return
    request.current ??= {
      action: 'commit',
      tenantId,
      requestId: crypto.randomUUID(),
      token: row.token,
      mode,
      itemId: mode === 'link' ? (item?.id ?? null) : null,
      sellerId: mode === 'create' ? (seller?.id ?? null) : null,
      context: mode === 'create' ? context : null,
      received,
    }
    running.current = true
    setBusy(true)
    setError('')
    setUncertain(true)
    try {
      props.onDone(posResult.parse(await call(request.current)).item)
    } catch (e) {
      setError(errorText(e, d))
      if (
        e instanceof Error &&
        e.message in d.errors &&
        e.message !== 'REQUEST_FAILED'
      ) {
        setUncertain(false)
        request.current = null
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="pos-import-editor">
      <div className="pos-import-editor-heading">
        <strong>{row.product.title}</strong>
        <button
          className="text-link"
          disabled={busy || uncertain}
          onClick={props.onToggle}
        >
          {d.close}
        </button>
      </div>
      {!props.supported ? (
        <p role="status">{d.unsupported}</p>
      ) : (
        <>
          <fieldset disabled={busy || uncertain} className="pos-import-modes">
            <legend className="sr-only">{d.action}</legend>
            <label>
              <input
                type="radio"
                name={`mode-${row.product.variantId}`}
                checked={mode === 'create'}
                onChange={() => setMode('create')}
              />
              {d.create}
            </label>
            <label>
              <input
                type="radio"
                name={`mode-${row.product.variantId}`}
                checked={mode === 'link'}
                onChange={() => setMode('link')}
              />
              {d.link}
            </label>
          </fieldset>
          {mode === 'create' ? (
            <div className="pos-import-selection">
              {seller ? (
                <p>
                  <strong>{seller.name}</strong>{' '}
                  <button
                    className="text-link"
                    disabled={busy || uncertain}
                    onClick={() => {
                      setSeller(null)
                      setContext(null)
                    }}
                  >
                    {d.change}
                  </button>
                </p>
              ) : (
                <QuickSellerPicker
                  tenantId={tenantId}
                  sellers={props.sellers}
                  total={props.sellerCount}
                  onSelect={chooseSeller}
                  d={props.quick}
                />
              )}
              <p>
                <small>{d.terms}</small>
              </p>
              <label className="pos-import-check">
                <input
                  type="checkbox"
                  checked={received}
                  disabled={busy || uncertain}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                {d.custody}
              </label>
            </div>
          ) : (
            <div className="pos-import-selection">
              <form
                className="pos-import-toolbar"
                onSubmit={(e) => {
                  e.preventDefault()
                  search()
                }}
              >
                <label
                  className="sr-only"
                  htmlFor={`item-${row.product.variantId}`}
                >
                  {d.findItem}
                </label>
                <input
                  id={`item-${row.product.variantId}`}
                  value={query}
                  disabled={busy || uncertain}
                  maxLength={120}
                  placeholder={d.findItem}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={busy || uncertain || !query.trim()}
                >
                  {d.searchButton}
                </Button>
              </form>
              {choices.length === 0 && <p>{d.noMatches}</p>}
              <fieldset
                disabled={busy || uncertain}
                className="pos-import-choices"
              >
                <legend className="sr-only">{d.link}</legend>
                {choices.map((choice) => (
                  <label key={choice.id}>
                    <input
                      type="radio"
                      name={`item-choice-${row.product.variantId}`}
                      checked={item?.id === choice.id}
                      onChange={() => setItem(choice)}
                    />
                    <span>
                      <strong>{choice.title}</strong>
                      <small>
                        {choice.reference} · {choice.seller ?? d.own} ·{' '}
                        {formatMoney(choice.priceOre, props.currency)}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {item && item.priceOre !== row.product.priceOre && (
                <p role="alert">{d.errors.POS_PRICE_MISMATCH}</p>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {uncertain && <p role="status">{d.retryInfo}</p>}
      <div className="pos-import-toolbar">
        {props.supported && (
          <Button
            disabled={
              busy ||
              (!uncertain &&
                (mode === 'create'
                  ? !seller || !context || !received
                  : !item || item.priceOre !== row.product.priceOre))
            }
            onClick={commit}
          >
            {busy
              ? d.saving
              : uncertain
                ? d.retry
                : mode === 'create'
                  ? d.import
                  : d.saveLink}
          </Button>
        )}
        <button
          className="text-link"
          disabled={busy || uncertain}
          onClick={props.onSkip}
        >
          <SkipForward size={16} aria-hidden="true" />
          {d.skip}
        </button>
      </div>
    </div>
  )
}
