import { notFound, redirect } from 'next/navigation'
import { platformContext } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  authorizeRequest,
  connectorsEnabled,
  deniedRedirect,
  readClient,
  requestedScopes,
} from '@/lib/engine/connectors'
import { ConnectorConsent } from '@/components/platform/connector-consent'

/**
 * The OAuth authorization endpoint: a signed-in member chooses the store and
 * the scopes an assistant gets. An invalid request is shown, never redirected,
 * because the redirect target is only trusted once the client is known.
 */
export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!connectorsEnabled()) notFound()
  const params = await searchParams
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  )
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired) {
    const back = `/oauth/authorize?${new URLSearchParams(
      Object.entries(flat).filter((e): e is [string, string] => !!e[1]),
    ).toString()}`
    redirect(`${ctx ? '/mfa' : '/login'}?next=${encodeURIComponent(back)}`)
  }
  const d = dictionary(ctx.locale)
  const request = authorizeRequest.safeParse(flat)
  const invalid = (
    <section
      className="card intake-form"
      aria-label={d.connectors.consent.title}
    >
      <h1>{d.connectors.consent.title}</h1>
      <p role="alert">{d.connectors.consent.invalid}</p>
    </section>
  )
  if (!request.success) return invalid
  const client = await readClient(ctx.client, request.data.client_id)
  if (!client || !client.redirectUris.includes(request.data.redirect_uri))
    return invalid
  const members = ctx.tenants.filter((t) =>
    ['owner', 'admin', 'staff', 'readonly'].includes(t.role),
  )
  if (members.length === 0)
    return (
      <section
        className="card intake-form"
        aria-label={d.connectors.consent.title}
      >
        <h1>{d.connectors.consent.title}</h1>
        <p role="alert">{d.connectors.consent.notMember}</p>
      </section>
    )
  const stores = members.map((t) => ({ id: t.id, name: t.name }))
  return (
    <ConnectorConsent
      clientName={client.name}
      clientId={client.clientId}
      redirectUri={request.data.redirect_uri}
      codeChallenge={request.data.code_challenge}
      state={request.data.state}
      stores={stores}
      defaultStore={
        stores.find((s) => s.id === ctx.active?.id)?.id ?? stores[0].id
      }
      requested={requestedScopes(request.data.scope)}
      deniedUrl={deniedRedirect(request.data.redirect_uri, request.data.state)}
      d={d.connectors}
    />
  )
}
