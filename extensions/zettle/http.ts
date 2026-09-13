import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'
import {
  catalogProduct,
  projectRemoteProduct,
  sameProduct,
  type CatalogProduct,
} from './catalog'
import { cursor } from './purchase'
import type { ZettleTransport } from './transport'
export interface ZettleClient extends ZettleTransport {
  putProduct(
    product: CatalogProduct,
    previous: CatalogProduct | null,
  ): Promise<void>
}
/** Current official API hosts only; token lifecycle is supplied by the connected host. */
export function zettleHttpClient(options: {
  organizationId: string
  accessToken: () => Promise<string>
  fetch?: typeof fetch
  startDate?: string
  endDate?: string
}): ZettleClient {
  const org = z.uuid().parse(options.organizationId),
    start =
      options.startDate === undefined
        ? undefined
        : z.iso.datetime().parse(options.startDate),
    end =
      options.endDate === undefined
        ? undefined
        : z.iso.datetime().parse(options.endDate)
  if (
    (start === undefined) !== (end === undefined) ||
    (start && end && start >= end)
  )
    throw new Error('ZETTLE_WINDOW_INVALID')
  const http = options.fetch ?? globalThis.fetch
  let identity: Promise<void> | undefined
  async function call(
    url: string,
    method = 'GET',
    body?: unknown,
    etag?: string,
  ) {
    const token = await options.accessToken()
    if (!token || /[\r\n]/.test(token)) throw new Error('ZETTLE_AUTH_REQUIRED')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (etag) headers['If-Match'] = etag
    const r = await http(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    if (r.status === 403 && url.startsWith('https://products.izettle.com/'))
      throw new Error('ZETTLE_PRODUCT_ACCESS_DENIED')
    if ([401, 403].includes(r.status)) throw new Error('ZETTLE_AUTH_REQUIRED')
    if (r.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
    if (r.status >= 500) throw new Error('ZETTLE_RETRY_LATER')
    return r
  }
  async function verify() {
    identity ??= (async () => {
      const r = await call('https://oauth.zettle.com/users/self')
      if (r.status !== 200) throw new Error('ZETTLE_AUTH_REQUIRED')
      const user = z
        .object({ organizationUuid: z.uuid() })
        .parse(await boundedJson(r, 8192))
      if (user.organizationUuid !== org)
        throw new Error('ZETTLE_WRONG_MERCHANT')
    })()
    return identity
  }
  async function get(id: string) {
    const r = await call(
      `https://products.izettle.com/organizations/${org}/products/${id}`,
    )
    if (r.status === 404) return null
    if (r.status !== 200) {
      const detail = await boundedJson(r, 8192).catch(() => null)
      throw new ProductHttpError(r.status, detail)
    }
    const raw = await boundedJson(r, 65536)
    return { product: projectRemoteProduct(raw), etag: r.headers.get('etag') }
  }
  return {
    async putProduct(input, old) {
      await verify()
      const p = catalogProduct.parse(input),
        previous = old ? catalogProduct.parse(old) : null
      let remote = await get(p.uuid)
      if (remote && sameProduct(remote.product, p)) return
      if (!remote) {
        if (previous) throw new Error('ZETTLE_REMOTE_MISSING')
        const r = await call(
          `https://products.izettle.com/organizations/${org}/products`,
          'POST',
          p,
        )
        if (r.status === 400 || r.status === 422)
          throw new Error('ZETTLE_PRODUCT_REJECTED')
        if (![201, 409].includes(r.status))
          throw new Error('ZETTLE_CREATE_FAILED')
        // Also reconciles a lost successful POST on the next retry with the same UUID.
        remote = await get(p.uuid)
        if (!remote || !sameProduct(remote.product, p))
          throw new Error('ZETTLE_REMOTE_CHANGED')
        return
      }
      if (!previous || !sameProduct(remote.product, previous) || !remote.etag)
        throw new Error('ZETTLE_REMOTE_CHANGED')
      const r = await call(
        `https://products.izettle.com/organizations/${org}/products/v2/${p.uuid}`,
        'PUT',
        p,
        remote.etag,
      )
      if (r.status === 412) throw new Error('ZETTLE_REMOTE_CHANGED')
      if (r.status !== 204) throw new Error('ZETTLE_UPDATE_FAILED')
      remote = await get(p.uuid)
      if (!remote || !sameProduct(remote.product, p))
        throw new Error('ZETTLE_REMOTE_CHANGED')
    },
    async fetchPage(input) {
      input.signal.throwIfAborted()
      if (!start || !end) throw new Error('ZETTLE_WINDOW_INVALID')
      await verify()
      const query = new URLSearchParams({
        startDate: start,
        endDate: end,
        limit: '100',
        descending: 'false',
      })
      const previous = cursor.parse(input.cursor)
      if (previous) query.set('lastPurchaseHash', previous)
      const r = await call(`https://purchase.izettle.com/purchases/v2?${query}`)
      if (r.status !== 200) throw new Error('ZETTLE_READ_FAILED')
      return boundedJson(r, 1048576)
    },
  }
}

/** Status and a finite keyword set only, never the provider body or its values. */
export class ProductHttpError extends Error {
  readonly httpStatus: number
  readonly hints: string[]
  constructor(status: number, detail: unknown) {
    super('ZETTLE_READ_FAILED')
    this.httpStatus =
      Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0
    const text = JSON.stringify(detail).toLowerCase()
    this.hints = [
      'uuid',
      'organization',
      'etag',
      'scope',
      'permission',
      'vat',
      'tax',
    ].filter((k) => text.includes(k))
  }
}
