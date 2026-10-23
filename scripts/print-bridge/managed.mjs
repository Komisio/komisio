import { createServer, request as proxyRequest } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { authEndpoint, deviceScope } from './auth.mjs'
import { createEnrollmentStore } from './enrollment-store.mjs'
import { enrollWeblinkDevice } from './enrollment.mjs'
import { createProvisionedWeblinkService } from './runtime.mjs'
import { pollWeblinkService } from './poller.mjs'
import { setupBundle, validateCaBundle } from './setup-bundle.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const secret = /^[A-Za-z0-9_-]{43}$/
const failure = (code = 'UNAVAILABLE') => new Error(`PRINT_MANAGED_${code}`)
const equal = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** One environment, bounded device instances. Existing per-device auth, queue
 * fencing and journals remain the authority. The management credential is used
 * only by the application's owner/admin route, never by browsers or printers.
 * A durable registry lock prevents a second gateway from owning these instances.
 * Old generations are retained; replacement requires a server-authorized CAS.
 */
export async function createManagedWeblink({
  directory,
  encryptionKey,
  url,
  publishableKey,
  host,
  proxySecret,
  managementSecret,
  caBundle,
  port = 0,
  capacity = 32,
  fetchImpl = fetch,
  enroll = enrollWeblinkDevice,
  start = createProvisionedWeblinkService,
  poll = pollWeblinkService,
}) {
  const environment = {
    url: authEndpoint(url, publishableKey).href,
    publishableKey,
    host,
  }
  caBundle = validateCaBundle(caBundle)
  if (
    !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host ?? '') ||
    host.length > 253 ||
    !secret.test(proxySecret ?? '') ||
    !secret.test(managementSecret ?? '') ||
    equal(proxySecret, managementSecret) ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 64 ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw failure('CONFIG')
  const registry = await createEnrollmentStore(directory, encryptionKey)
  const workers = new Map()
  const sockets = new Set()
  let state,
    closing = false,
    mutation = null
  const instancePath = (entry) => join(directory, entry.generation)
  const scopeOf = (entry) => deviceScope(entry)
  const snapshot = (entry) =>
    entry
      ? {
          state: entry.deviceId
            ? workers.has(entry.deviceId)
              ? 'ready'
              : 'held'
            : 'pending',
          deviceId: entry.deviceId,
        }
      : { state: 'absent', deviceId: null }
  async function save(next) {
    await registry.save(next)
    state = next
  }
  async function stopWorker(id) {
    const worker = workers.get(id)
    if (!worker) return
    workers.delete(id)
    worker.stop.abort()
    await worker.done
  }
  async function launch(entry) {
    if (workers.has(entry.deviceId)) return
    const service = await start({
      directory: join(instancePath(entry), 'device'),
      encryptionKey,
      scope: scopeOf(entry),
      url,
      publishableKey,
      proxyHost: host,
      proxySecret,
      port: 0,
      fetchImpl,
    })
    const stop = new AbortController()
    const worker = { service, stop, done: null }
    workers.set(entry.deviceId, worker)
    worker.done = poll({ service, signal: stop.signal }).catch(() => {
      // Never restart automatically after uncertain dispatch or storage failure.
      if (workers.get(entry.deviceId) === worker) workers.delete(entry.deviceId)
    })
  }
  try {
    state = (await registry.load()) ?? { version: 1, environment, entries: [] }
    if (
      state.version !== 1 ||
      JSON.stringify(state.environment) !== JSON.stringify(environment) ||
      !Array.isArray(state.entries) ||
      state.entries.length > capacity
    )
      throw failure('REGISTRY')
    const ids = new Set()
    const deviceIds = new Set()
    for (const entry of state.entries) {
      if (
        !uuid.test(entry.generation) ||
        !uuid.test(entry.tenantId) ||
        !uuid.test(entry.printerId) ||
        ids.has(entry.printerId) ||
        (entry.deviceId !== null && !uuid.test(entry.deviceId)) ||
        (entry.deviceId !== null && deviceIds.has(entry.deviceId)) ||
        typeof entry.name !== 'string' ||
        entry.name.length > 80
      )
        throw failure('REGISTRY')
      ids.add(entry.printerId)
      if (entry.deviceId) deviceIds.add(entry.deviceId)
      if (entry.deviceId) await launch(entry).catch(() => {})
    }
  } catch (error) {
    for (const id of workers.keys()) await stopWorker(id)
    await registry.close()
    throw error
  }

  function binding(input) {
    if (!input || !uuid.test(input.tenantId) || !uuid.test(input.printerId))
      throw failure('INPUT')
    const entry = state.entries.find((e) => e.printerId === input.printerId)
    if (entry && entry.tenantId !== input.tenantId) throw failure('SCOPE')
    return entry
  }
  async function provision(input) {
    let entry = binding(input)
    if (input.replaceDeviceId !== undefined) {
      if (
        !uuid.test(input.replaceDeviceId) ||
        entry?.deviceId !== input.replaceDeviceId
      )
        throw failure('CONFLICT')
      await stopWorker(entry.deviceId)
      entry = null
    } else if (entry?.deviceId) return snapshot(entry)
    if (!entry) {
      if (
        !state.entries.some((e) => e.printerId === input.printerId) &&
        state.entries.length >= capacity
      )
        throw failure('CAPACITY')
      if (
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 80 ||
        /[\x00-\x1f\x7f]/.test(input.name)
      )
        throw failure('INPUT')
      entry = {
        tenantId: input.tenantId,
        printerId: input.printerId,
        name: input.name.trim(),
        generation: randomUUID(),
        deviceId: null,
      }
      await save({
        ...state,
        entries: [
          ...state.entries.filter((e) => e.printerId !== entry.printerId),
          entry,
        ],
      })
    }
    // Same durable generation on retries, including a lost HTTP response.
    await mkdir(instancePath(entry), { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    const result = await enroll({
      directory: instancePath(entry),
      encryptionKey,
      url,
      publishableKey,
      tenantId: entry.tenantId,
      printerId: entry.printerId,
      deviceName: entry.name,
      pairingCode: input.code,
      fetchImpl,
    })
    if (
      result.tenantId !== entry.tenantId ||
      result.printerId !== entry.printerId
    )
      throw failure('SCOPE')
    scopeOf(result)
    if (
      state.entries.some(
        (e) =>
          e.printerId !== entry.printerId && e.deviceId === result.deviceId,
      )
    )
      throw failure('SCOPE')
    const completed = { ...entry, deviceId: result.deviceId }
    await save({
      ...state,
      entries: state.entries.map((e) =>
        e.printerId === entry.printerId ? completed : e,
      ),
    })
    await launch(completed)
    return snapshot(completed)
  }
  async function configuration(input) {
    const entry = binding(input)
    if (!entry?.deviceId || entry.deviceId !== input.deviceId)
      throw failure('CONFLICT')
    const checkpoint = await createEnrollmentStore(
      instancePath(entry),
      encryptionKey,
    )
    try {
      const record = await checkpoint.load()
      if (
        record?.phase !== 'complete' ||
        record.deviceId !== entry.deviceId ||
        record.binding?.tenantId !== entry.tenantId ||
        record.binding?.printerId !== entry.printerId ||
        record.binding?.url !== authEndpoint(url, publishableKey).href ||
        record.binding?.publishableKey !== publishableKey
      )
        throw failure('SCOPE')
      return {
        deviceId: entry.deviceId,
        configuration: setupBundle(caBundle, host, {
          ...scopeOf(entry),
          password: record.password,
        }),
      }
    } finally {
      await checkpoint.close()
    }
  }
  function proxyAllowed(req, challenge = false) {
    const names = req.rawHeaders
      .filter((_value, index) => index % 2 === 0)
      .map((name) => name.toLowerCase())
    return (
      ['host', 'x-forwarded-proto', 'x-komisio-bridge'].every(
        (name) => names.filter((n) => n === name).length === 1,
      ) &&
      (challenge
        ? names.filter((name) => name === 'authorization').length <= 1
        : names.filter((name) => name === 'authorization').length === 1) &&
      names.filter((name) => name === 'sec-websocket-protocol').length <= 1 &&
      req.headers.host === host &&
      req.headers['x-forwarded-proto'] === 'https' &&
      equal(req.headers['x-komisio-bridge'], proxySecret)
    )
  }
  const server = createServer(async (req, res) => {
    const reply = (status, data) =>
      res
        .writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(JSON.stringify(data))
    if (req.method === 'GET' && req.url === '/healthz')
      return reply(200, { ready: !closing })
    if (
      closing ||
      !proxyAllowed(req) ||
      req.headers.origin ||
      !equal(req.headers.authorization, `Bearer ${managementSecret}`)
    )
      return reply(403, { error: 'FORBIDDEN' })
    if (
      req.method !== 'POST' ||
      !['/manage/lookup', '/manage/enroll', '/manage/configuration'].includes(
        req.url,
      )
    )
      return reply(404, { error: 'NOT_FOUND' })
    try {
      let size = 0
      const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 8192) throw failure('INPUT')
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const entry = binding(input)
      if (req.url === '/manage/lookup') return reply(200, snapshot(entry))
      if (mutation) return reply(409, { error: 'PRINT_MANAGED_BUSY' })
      mutation =
        req.url === '/manage/enroll' ? provision(input) : configuration(input)
      try {
        return reply(200, await mutation)
      } finally {
        mutation = null
      }
    } catch {
      // Never log input, credentials, pairing codes or upstream bodies.
      return reply(409, { error: 'PRINT_MANAGED_REVIEW_REQUIRED' })
    }
  })
  server.headersTimeout = 10000
  server.requestTimeout = 40000
  server.maxHeadersCount = 32
  server.maxConnections = capacity * 8 + 8
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.setTimeout(50000, () => socket.destroy())
  })
  server.on('upgrade', (req, socket, head) => {
    const match = /^\/weblink\/([0-9a-f-]{36})$/.exec(req.url ?? '')
    const worker = match && workers.get(match[1])
    if (closing || !worker || !proxyAllowed(req, true)) return socket.destroy()
    const challenge = () =>
      socket.end(
        'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Komisio print"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      )
    // Firmware waits for the Basic challenge before sending its credentials.
    // This response opens no channel and never reaches the queue worker.
    if (!req.headers.authorization) return challenge()
    const upstream = proxyRequest({
      host: '127.0.0.1',
      port: worker.service.address.port,
      path: req.url,
      method: 'GET',
      headers: {
        ...req.headers,
        host,
        'x-komisio-bridge': proxySecret,
        'x-forwarded-proto': 'https',
      },
    })
    upstream.setTimeout(10000, () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
    upstream.on('response', (response) => {
      response.resume()
      if (response.statusCode === 401) challenge()
      else socket.destroy()
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      if (
        response.statusCode !== 101 ||
        workers.get(match[1]) !== worker ||
        closing
      ) {
        remote.destroy()
        socket.destroy()
        return
      }
      socket.setTimeout(0)
      remote.setTimeout(0)
      remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy())
      remote.on('close', () => socket.destroy())
      const headers = response.rawHeaders.reduce(
        (out, value, index, all) =>
          index % 2 ? out : `${out}${value}: ${all[index + 1]}\r\n`,
        '',
      )
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`)
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.pipe(remote).pipe(socket)
    })
    socket.on('close', () => upstream.destroy())
    upstream.end()
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    for (const id of workers.keys()) await stopWorker(id)
    await registry.close()
    throw error
  }
  return {
    address: server.address(),
    async close() {
      closing = true
      for (const socket of sockets) socket.destroy()
      await mutation?.catch(() => {})
      for (const id of workers.keys()) await stopWorker(id)
      await new Promise((resolve) => server.close(resolve))
      await registry.close()
    },
  }
}
