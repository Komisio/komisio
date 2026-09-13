import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readMySellerAccounts,
  readMySellerEconomy,
  readMySellerStatement,
} from '@/lib/engine/seller-portal'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
import { SellerEconomyForms } from '@/components/seller/economy-forms'
import { SignOut } from '@/components/platform/sign-out'
import { Brand } from '@/components/platform/brand'
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}
export default async function SellerPortal({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string; statement?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await platformContext()
  if (!ctx) redirect('/login?next=%2Fseller')
  if (ctx.mfaRequired) redirect('/mfa?next=%2Fseller')
  const all = dictionary(ctx.locale)
  const d = all.sellerPortal
  const label = (labels: Record<string, string>, key: string) =>
    labels[key] ?? d.kind
  const params = await searchParams
  const accounts = await readMySellerAccounts(ctx.client)
  const account = params.seller
    ? accounts.find((a) => a.sellerId === params.seller)
    : null
  if (params.seller && !account) notFound()
  const when = (date: string) =>
    new Date(date).toLocaleString(ctx.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  const amount = (ore: number) => `${formatSignedOre(ore)} SEK`
  if (!account)
    return (
      <main className="onboarding">
        <Brand />
        <SignOut d={all} next="/seller" />
        <section className="card">
          <h1>{d.title}</h1>
          <p>{ctx.user.email}</p>
          {accounts.length === 0 && <p>{d.empty}</p>}
          {accounts.map((a) => (
            <p key={a.sellerId}>
              <Link href={`/seller?seller=${a.sellerId}`}>{a.storeName}</Link>
            </p>
          ))}
        </section>
      </main>
    )
  const base = `/seller?seller=${account.sellerId}`
  if (params.statement) {
    if (!/^[0-9a-f-]{36}$/i.test(params.statement)) notFound()
    const statement = await readMySellerStatement(
      ctx.client,
      account.tenantId,
      account.sellerId,
      params.statement,
    )
    if (!statement) notFound()
    return (
      <main className="onboarding">
        <Brand />
        <SignOut d={all} next="/seller" />
        <section className="card">
          <Link href={base}>{account.storeName}</Link>
          <h1>
            {d.statements} #{statement.header.number}
          </h1>
          <p>
            {when(statement.header.period_from)} —{' '}
            {when(statement.header.period_to)}
          </p>
          <p>
            {d.opening}: {amount(statement.header.opening_ore)}
          </p>
          <p>
            {d.closing}: {amount(statement.header.closing_ore)}
          </p>
          <table>
            <thead>
              <tr>
                <th>{d.date}</th>
                <th>{d.kind}</th>
                <th>{d.amount}</th>
                <th>{d.salePrice}</th>
                <th>{d.commission}</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l) => (
                <tr key={l.id}>
                  <td>{when(l.occurred_at)}</td>
                  <td>{label(all.ledger.kinds, l.kind)}</td>
                  <td>{amount(l.amount_ore)}</td>
                  <td>
                    {l.sale_price_ore === null ? '—' : amount(l.sale_price_ore)}
                  </td>
                  <td>
                    {l.commission_ore === null ? '—' : amount(l.commission_ore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    )
  }
  const economy = await readMySellerEconomy(
    ctx.client,
    account.tenantId,
    account.sellerId,
  )
  return (
    <main className="onboarding">
      <Brand />
      <SignOut d={all} next="/seller" />
      <div className="page-heading">
        <Link href="/seller">{d.back}</Link>
        <h1>
          {account.storeName} · {d.title}
        </h1>
        <p>{ctx.user.email}</p>
      </div>
      <section className="card">
        <h2>
          {d.available}: {amount(economy.balance.availableOre)}
        </h2>
        <p>
          {d.reserved}: {amount(economy.balance.reservedOre)}
        </p>
      </section>
      <SellerEconomyForms
        key={`${account.sellerId}-${economy.automaticEmails}`}
        tenantId={account.tenantId}
        sellerId={account.sellerId}
        availableOre={economy.balance.availableOre}
        thresholdOre={economy.thresholdOre}
        enabled={economy.automaticEmails}
        d={d}
      />
      <p>{d.recent}</p>
      <section className="card">
        <h2>{d.payouts}</h2>
        {economy.payouts.length === 0 && <p>{d.none}</p>}
        {economy.payouts.map((p) => (
          <p key={p.id}>
            {when(p.requested_at)} · {amount(p.amount_ore)} ·{' '}
            {label(all.payouts.statuses, p.status)} · {d.source}:{' '}
            {d[p.request_source]}
          </p>
        ))}
      </section>
      <section className="card">
        <h2>{d.ledger}</h2>
        {economy.ledger.length === 0 && <p>{d.none}</p>}
        {economy.ledger.map((l) => (
          <p key={l.id}>
            {when(l.occurred_at)} · {label(all.ledger.kinds, l.kind)} ·{' '}
            {amount(l.amount_ore)}
          </p>
        ))}
      </section>
      <section className="card">
        <h2>{d.statements}</h2>
        {economy.statements.length === 0 && <p>{d.none}</p>}
        {economy.statements.map((s) => (
          <p key={s.id}>
            <Link href={`${base}&statement=${s.id}`}>
              {d.open} #{s.number}
            </Link>{' '}
            · {amount(s.closing_ore)}
          </p>
        ))}
      </section>
      <section className="card">
        <h2>{d.messages}</h2>
        {economy.messages.length === 0 && <p>{d.none}</p>}
        {economy.messages.map((m) => (
          <article key={m.id}>
            <h3>{m.subject}</h3>
            <p>
              {when(m.queued_at)} ·{' '}
              {label(all.communications.outcomes, m.status)}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
