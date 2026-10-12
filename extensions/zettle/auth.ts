import { inventoryHttpClient } from './inventory'
import { z } from 'zod'
import { zettleHttpClient } from './http'
import { paypalMerchant } from './oauth'
// Internal transport envelope, produced only by the authorized OAuth engine.
export type PilotEnvironment = {
  ZETTLE_ACCESS_TOKEN?: string
  ZETTLE_ACCESS_EXPIRES_AT?: string
  ZETTLE_PILOT_TENANT_ID?: string
  ZETTLE_MERCHANT_ID?: string
}
export type PilotIssue = 'connectionUnavailable'
export function pilotIssue(
  tenantId: string,
  env: PilotEnvironment,
): PilotIssue | null {
  return z.uuid().safeParse(tenantId).success &&
    env.ZETTLE_PILOT_TENANT_ID === tenantId &&
    z.uuid().safeParse(env.ZETTLE_MERCHANT_ID).success &&
    !!env.ZETTLE_ACCESS_TOKEN &&
    !/[\s\x00-\x1f\x7f]/.test(env.ZETTLE_ACCESS_TOKEN) &&
    Number(env.ZETTLE_ACCESS_EXPIRES_AT) > Date.now() + 30000
    ? null
    : 'connectionUnavailable'
}
export function pilotAvailable(tenantId: string, env: PilotEnvironment) {
  return pilotIssue(tenantId, env) === null
}
export function pilotEnvironment(
  env: Record<string, string | undefined>,
): PilotEnvironment {
  return {
    ZETTLE_PILOT_TENANT_ID: env.ZETTLE_PILOT_TENANT_ID,
    ZETTLE_MERCHANT_ID: env.ZETTLE_MERCHANT_ID,
    ZETTLE_ACCESS_TOKEN: env.ZETTLE_ACCESS_TOKEN,
    ZETTLE_ACCESS_EXPIRES_AT: env.ZETTLE_ACCESS_EXPIRES_AT,
  }
}
async function acquirePilotSession(
  tenantId: string,
  env: PilotEnvironment,
  http: typeof fetch = fetch,
) {
  if (!pilotAvailable(tenantId, env)) throw new Error('ZETTLE_NOT_CONNECTED')
  const organizationId = await paypalMerchant(env.ZETTLE_ACCESS_TOKEN!, http)
  if (organizationId !== env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_WRONG_MERCHANT')
  return {
    accessToken: env.ZETTLE_ACCESS_TOKEN!,
    expiresAt: Number(env.ZETTLE_ACCESS_EXPIRES_AT),
    organizationId,
    merchantPinned: true,
    checkedAt: new Date().toISOString(),
  }
}
/** Never return an access token to the engine, route or browser. */
export async function verifyPilotConnection(
  tenantId: string,
  source: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  const { organizationId, merchantPinned, checkedAt } =
    await acquirePilotSession(tenantId, source, http)
  return { organizationId, merchantPinned, checkedAt }
}
/** A per-invocation client with a mandatory merchant pin, no global token cache. */
export async function connectedPilotClient(
  tenantId: string,
  source: PilotEnvironment,
  window: { startDate: string; endDate: string },
  http: typeof fetch = globalThis.fetch,
) {
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  let lease = await acquirePilotSession(tenantId, env, http)
  return zettleHttpClient({
    organizationId: env.ZETTLE_MERCHANT_ID,
    ...window,
    fetch: http,
    accessToken: async () => {
      if (lease.expiresAt <= Date.now() + 30000)
        lease = await acquirePilotSession(tenantId, env, http)
      return lease.accessToken
    },
  })
}

/** Catalog and inventory share a private merchant-verified lease, without a purchase window. */
export async function connectedPilotCatalog(
  tenantId: string,
  source: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  let lease = await acquirePilotSession(tenantId, env, http)
  const token = async () => {
    if (lease.expiresAt <= Date.now() + 30000)
      lease = await acquirePilotSession(tenantId, env, http)
    return lease.accessToken
  }
  const catalog = zettleHttpClient({
    organizationId: env.ZETTLE_MERCHANT_ID,
    accessToken: token,
    fetch: http,
  })
  return {
    putProduct: catalog.putProduct,
    inventory: inventoryHttpClient(env.ZETTLE_MERCHANT_ID, token, http),
  }
}

export async function connectedPilotImages(
  tenantId: string,
  source: PilotEnvironment,
  http: typeof fetch = globalThis.fetch,
) {
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  let lease = await acquirePilotSession(tenantId, env, http)
  const token = async () => {
    if (lease.expiresAt <= Date.now() + 30000)
      lease = await acquirePilotSession(tenantId, env, http)
    return lease.accessToken
  }
  const { imageHttpClient } = await import('./images')
  const catalog = zettleHttpClient({
    organizationId: env.ZETTLE_MERCHANT_ID,
    accessToken: token,
    fetch: http,
  })
  return {
    uploadImage: imageHttpClient(env.ZETTLE_MERCHANT_ID, token, http),
    putProduct: catalog.putProduct,
  }
}
