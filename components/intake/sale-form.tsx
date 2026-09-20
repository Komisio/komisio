'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import { exactPrice } from '@/lib/engine/manual-reception'
import { saleSearchRows, type SaleSearchItem } from '@/lib/engine/sale-search'
import { useIntakeAction } from './use-intake-action'
import { Button } from '@/components/ui/button'

const decimal = (ore: bigint) =>
  `${ore / 100n}.${String(ore % 100n).padStart(2, '0')}`
export function SaleForm({
  tenantId,
  currency,
  d,
  intake,
}: {
  tenantId: string
  currency: string
  d: Dictionary['sales']
  intake: Dictionary['intake']
}) {
  const action = useIntakeAction(intake),
    router = useRouter()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [externalId, setExternalId] = useState(() => crypto.randomUUID())
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<SaleSearchItem[]>([])
  const [searched, setSearched] = useState(false),
    [searching, setSearching] = useState(false)
  const [cart, setCart] = useState<(SaleSearchItem & { price: string })[]>([])
  const [error, setError] = useState(''),
    [saved, setSaved] = useState<string | null>(null)
  const searchVersion = useRef(0),
    searchInput = useRef<HTMLInputElement>(null)
  const locked = action.busy || action.locked
  let total: bigint | null = 0n
  try {
    for (const item of cart)
      total += BigInt(exactPrice(item.price).replace('.', ''))
  } catch {
    total = null
  }
  async function search() {
    const q = query.trim(),
      version = ++searchVersion.current
    if (q.length < 2 || locked) return
    setSearching(true)
    setError('')
    setResults([])
    setSearched(false)
    try {
      const r = await fetch(
        `/api/sales/items?${new URLSearchParams({ tenant: tenantId, q })}`,
        { cache: 'no-store' },
      )
      if (!r.ok) throw new Error()
      const rows = saleSearchRows.parse((await r.json()).items)
      if (version === searchVersion.current) {
        setResults(rows)
        setSearched(true)
      }
    } catch {
      if (version === searchVersion.current) setError(d.searchFailed)
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }
  function add(item: SaleSearchItem) {
    setCart((current) =>
      current.some((i) => i.id === item.id) || current.length >= 50
        ? current
        : [...current, { ...item, price: decimal(BigInt(item.priceOre)) }],
    )
    setSaved(null)
    searchInput.current?.focus()
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!cart.length) return
    setError('')
    let lines
    try {
      lines = cart.map((i) => ({ itemId: i.id, price: exactPrice(i.price) }))
    } catch {
      setError(d.priceInvalid)
      return
    }
    const id = await action.run({
      action: 'recordSale',
      tenantId,
      requestId,
      provider: 'manual',
      externalId,
      occurredAt: new Date().toISOString(),
      currency,
      lines,
    })
    if (id) {
      setSaved(id)
      setCart([])
      setResults([])
      setSearched(false)
      setQuery('')
      setRequestId(crypto.randomUUID())
      setExternalId(crypto.randomUUID())
      form.reset()
      router.refresh()
    }
  }
  return (
    <section className="card intake-form sale-workspace">
      <p>{d.recordHint}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
        className="sale-search"
      >
        <label htmlFor="sale-search">{d.search}</label>
        <div className="row">
          <input
            ref={searchInput}
            id="sale-search"
            value={query}
            maxLength={120}
            disabled={locked}
            placeholder={d.searchHint}
            onChange={(e) => {
              ++searchVersion.current
              setQuery(e.target.value)
              setSearching(false)
              setResults([])
              setSearched(false)
            }}
          />
          <Button disabled={locked || searching || query.trim().length < 2}>
            {searching ? intake.busy : d.searchButton}
          </Button>
        </div>
      </form>
      {searched && !results.length && <p role="status">{d.noMatches}</p>}
      {results.length > 20 && <p>{d.narrowSearch}</p>}
      <ul className="sale-search-results">
        {results.slice(0, 20).map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>
                I-{item.id.slice(0, 8).toUpperCase()} ·{' '}
                {decimal(BigInt(item.priceOre))} {currency}
              </small>
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={
                locked ||
                cart.some((i) => i.id === item.id) ||
                cart.length >= 50
              }
              onClick={() => add(item)}
            >
              {cart.some((i) => i.id === item.id) ? d.added : d.add}
            </Button>
          </li>
        ))}
      </ul>
      <h3>
        {d.cart} <small>({cart.length}/50)</small>
      </h3>
      {!cart.length && <p>{d.cartEmpty}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={locked} className="intake-fields">
          <ul className="sale-cart">
            {cart.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>I-{item.id.slice(0, 8).toUpperCase()}</small>
                </span>
                <div>
                  <label htmlFor={`price-${item.id}`}>
                    {d.price} ({currency})
                  </label>
                  <input
                    id={`price-${item.id}`}
                    inputMode="decimal"
                    required
                    value={item.price}
                    onChange={(e) =>
                      setCart(
                        cart.map((i) =>
                          i.id === item.id
                            ? { ...i, price: e.target.value }
                            : i,
                        ),
                      )
                    }
                  />
                </div>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setCart(cart.filter((i) => i.id !== item.id))}
                >
                  {d.remove}
                </button>
              </li>
            ))}
          </ul>
          {cart.length > 0 && (
            <>
              <p className="sale-total">
                {d.total}:{' '}
                <strong>
                  {total === null ? '—' : decimal(total)} {currency}
                </strong>
              </p>
              <label className="intake-confirm">
                <input type="checkbox" required />
                {d.confirm}
              </label>
            </>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {action.error && <p role="alert">{action.error}</p>}
        {action.needsReload && (
          <Link href="/intake/sales">{intake.reload}</Link>
        )}
        {cart.length > 0 && (
          <Button type="submit" disabled={action.busy || action.needsReload}>
            {action.busy
              ? intake.busy
              : action.locked
                ? intake.retry
                : d.record}
          </Button>
        )}
        {saved && (
          <p role="status">
            {d.recorded}{' '}
            <Link className="text-link" href={`/intake/sales/${saved}`}>
              {d.open}
            </Link>
          </p>
        )}
      </form>
    </section>
  )
}
