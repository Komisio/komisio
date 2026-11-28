import { z } from 'zod'
import { boundedJson } from './bounded-json'
import { anonClient } from '@/lib/engine/connectors'
import {
  inventorySecret,
  readStoreInventory,
} from '@/lib/engine/store-inventory-api'
import {
  recordSchemas,
  storeCommands,
  type StoreCommand,
} from '@/lib/engine/store-api-contract'
import {
  readStoreRecords,
  readStoreRequest,
  submitStoreCommand,
} from '@/lib/engine/store-api-commands'

const reply = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  })
const unauthorized = () =>
  reply({ error: 'INVALID_KEY' }, 401, {
    'WWW-Authenticate': 'Bearer realm="Komisio Store API"',
  })
const missing = () => reply({ error: 'NOT_FOUND' }, 404)
const invalid = () => reply({ error: 'INVALID_INPUT' }, 400)
const commands = Object.keys(storeCommands) as StoreCommand[]
export async function storeApiResponse(request: Request, segments: string[]) {
  const [resource, id = null, action] = segments
  const knownRecords = Object.hasOwn(recordSchemas, resource)
  if (
    segments.length > 3 ||
    (!knownRecords && resource !== 'items' && resource !== 'requests') ||
    (action !== undefined &&
      (resource !== 'items' || action !== 'end-period')) ||
    (resource === 'requests' && !id)
  )
    return missing()
  const secret = /^Bearer ([^ ]+)$/i.exec(
    request.headers.get('authorization') ?? '',
  )?.[1]
  if (!secret || !inventorySecret.test(secret)) return unauthorized()
  if (id !== null && !z.guid().safeParse(id).success) return invalid()
  const path =
    '/' + resource + (id ? '/{id}' : '') + (action ? '/' + action : '')
  const query = new URL(request.url).searchParams
  try {
    if (request.method === 'GET' && !action) {
      if (
        [...query.keys()].some(
          (k) =>
            id !== null ||
            !['limit', 'after'].includes(k) ||
            query.getAll(k).length !== 1,
        )
      )
        return invalid()
      const limit = query.get('limit') ?? '50',
        after = query.get('after')
      if (
        !/^(?:[1-9][0-9]?|100)$/.test(limit) ||
        (after !== null && !z.guid().safeParse(after).success)
      )
        return invalid()
      if (resource === 'requests' && id) {
        const value = await readStoreRequest(anonClient(), secret, id)
        return value ? reply(value) : missing()
      }
      if (resource === 'items') {
        const value = await readStoreInventory(
          anonClient(),
          secret,
          Number(limit),
          after,
          id,
        )
        return id
          ? value.items[0]
            ? reply(value.items[0])
            : missing()
          : reply(value)
      }
      const value = await readStoreRecords(
        anonClient(),
        secret,
        resource as keyof typeof recordSchemas,
        id,
        Number(limit),
        after,
      )
      return id
        ? value.records[0]
          ? reply(value.records[0])
          : missing()
        : reply(value)
    }
    const allowed = commands.filter((c) => storeCommands[c].path === path)
    const command = allowed.find(
      (c) => storeCommands[c].method.toUpperCase() === request.method,
    )
    if (!command)
      return reply({ error: 'METHOD_NOT_ALLOWED' }, 405, {
        Allow: [
          ...(action ? [] : ['GET']),
          ...allowed.map((c) => storeCommands[c].method.toUpperCase()),
        ].join(', '),
      })
    const replay = request.headers.get('idempotency-key')
    if (!z.uuid().safeParse(replay).success || !replay || query.size)
      return invalid()
    if (
      request.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json'
    )
      return reply({ error: 'JSON_REQUIRED' }, 415)
    const body = storeCommands[command].schema.safeParse(
      await boundedJson(request, 32768).catch(() => null),
    )
    if (!body.success) return invalid()
    const operation = await submitStoreCommand(
      anonClient(),
      secret,
      replay,
      command,
      id,
      body.data,
    )
    const location = '/api/public/v1/requests/' + operation.id
    if (operation.status === 'review')
      return reply({ id: operation.id, statusUrl: location }, 202, {
        Location: location,
      })
    return reply(
      { ...operation, statusUrl: location },
      operation.status === 'executed' ? 200 : 422,
      { Location: location },
    )
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (code === 'INVALID_KEY') return unauthorized()
    if (code === 'INSUFFICIENT_SCOPE') return reply({ error: code }, 403)
    if (code === 'INVALID_INPUT') return invalid()
    if (code === 'REQUEST_CONFLICT' || code === 'QUEUE_FULL')
      return reply({ error: code }, 409)
    if (code === 'RATE_LIMIT')
      return reply({ error: code }, 429, { 'Retry-After': '60' })
    return reply({ error: 'REQUEST_FAILED' }, 503)
  }
}
