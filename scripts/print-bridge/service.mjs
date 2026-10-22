import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { deviceScope } from './auth.mjs'
import { createWeblinkQueueWorker } from './queue.mjs'

export const MAIN_PROTOCOL = 'v1.weblink.zebra.com'
export const RAW_PROTOCOL = 'v1.raw.zebra.com'
const denied = () => new Error('PRINT_CHANNEL_UNAVAILABLE')

/**
 * One already-provisioned device, one process. The caller supplies existing
 * device-scoped auth/RPC, a dispatch journal and an exclusively owned attempt
 * store. Nothing listens on import and nothing polls automatically. Provisioning,
 * operator activation and physical TLS/channel verification are separate gates.
 *
 * Bind only to IPv4 loopback behind a TLS proxy that OVERWRITES the secret header,
 * Host and X-Forwarded-Proto. Never forward client-supplied versions of these.
 */
export async function createWeblinkService({
  scope: input,
  sessions,
  rpc,
  journal,
  attempts,
  proxyHost,
  proxySecret,
  port = 0,
  handshakeTimeoutMs = 10000,
  sendTimeoutMs = 5000,
  heartbeatMs = 30000,
}) {
  const scope = deviceScope(input)
  if (
    typeof proxyHost !== 'string' ||
    !/^[a-z0-9.-]+$/.test(proxyHost) ||
    typeof proxySecret !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(proxySecret) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    [handshakeTimeoutMs, sendTimeoutMs, heartbeatMs].some(
      (n) => !Number.isInteger(n) || n < 10 || n > 60000,
    )
  )
    throw new Error('INVALID_PRINT_SERVICE_CONFIG')
  const expectedSecret = Buffer.from(proxySecret)
  const path = `/weblink/${scope.deviceId}`
  let main = null
  let closing = false
  let upgrading = false
  let activeRun = null
  const sockets = new Set()
  const authentication = new Set()
  const server = createServer((_req, res) => {
    res
      .writeHead(404, { 'Content-Length': '0', 'Cache-Control': 'no-store' })
      .end()
  })
  server.headersTimeout = 10000
  server.requestTimeout = 10000
  server.maxHeadersCount = 32
  server.maxConnections = 8
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    socket.setTimeout(handshakeTimeoutMs, () => socket.destroy())
  })
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
    maxFragments: 128,
    maxBufferedChunks: 256,
    handleProtocols: (protocols) =>
      protocols.size === 1 ? [...protocols][0] : false,
  })
  // Zebra requires this on the successful upgrade response.
  wss.on('headers', (headers) => headers.push('Content-Length: 0'))

  function closeMain(entry) {
    if (!entry) return
    if (main === entry) main = null
    clearTimeout(entry.timer)
    sessions.close(entry.handle)
    if (entry.raw) {
      clearTimeout(entry.raw.timer)
      sessions.close(entry.raw.handle)
      entry.raw.ws.terminate()
    }
    entry.ws.terminate()
  }

  function arm(entry, ms) {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => closeMain(entry), ms)
  }

  function send(ws, bytes) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 80000)
        return reject(denied())
      const timer = setTimeout(() => {
        ws.terminate()
        reject(denied())
      }, sendTimeoutMs)
      ws.send(bytes, { binary: true }, (error) => {
        clearTimeout(timer)
        if (error || ws.readyState !== WebSocket.OPEN) reject(denied())
        else resolve()
      })
    })
  }

  function attach(ws, handle, protocol, parent) {
    ws.on('error', () => {})
    ws.alive = true
    ws.on('pong', () => {
      ws.alive = true
    })
    if (protocol === MAIN_PROTOCOL) {
      closeMain(main)
      const entry = { ws, handle, raw: null, requested: false, timer: null }
      main = entry
      arm(entry, handshakeTimeoutMs)
      ws.on('close', () => closeMain(entry))
      ws.on('message', (bytes, binary) => {
        try {
          if (main !== entry || entry.requested || !binary) throw denied()
          const message = JSON.parse(bytes.toString('utf8'))
          const discovery = message?.discovery_b64
          if (
            typeof discovery !== 'string' ||
            !discovery.length ||
            discovery.length > 16000 ||
            Buffer.from(discovery, 'base64').toString('base64') !== discovery
          )
            throw denied()
          // Discovery/serial are untrusted metadata, never an authentication key.
          entry.requested = true
          arm(entry, handshakeTimeoutMs)
          void send(
            ws,
            Buffer.from(JSON.stringify({ open: RAW_PROTOCOL })),
          ).catch(() => closeMain(entry))
        } catch {
          closeMain(entry)
        }
      })
    } else {
      const raw = { ws, handle, ready: false, timer: null }
      parent.raw = raw
      raw.timer = setTimeout(() => closeMain(parent), handshakeTimeoutMs)
      ws.on('close', () => closeMain(parent))
      ws.on('message', (bytes, binary) => {
        try {
          if (main !== parent || parent.raw !== raw || !binary) throw denied()
          // Subsequent binary data is printer output, not proof a label printed.
          if (raw.ready) return
          const message = JSON.parse(bytes.toString('utf8'))
          if (
            message?.channel_name !== RAW_PROTOCOL ||
            typeof message.unique_id !== 'string' ||
            message.unique_id.length < 1 ||
            message.unique_id.length > 128 ||
            typeof message.channel_id !== 'string' ||
            !/^\d{1,20}$/.test(message.channel_id)
          )
            throw denied()
          raw.ready = true
          clearTimeout(raw.timer)
          clearTimeout(parent.timer)
        } catch {
          closeMain(parent)
        }
      })
    }
  }

  function trusted(req) {
    const supplied = req.headers['x-komisio-bridge']
    const bytes =
      typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0)
    const sensitive = [
      'host',
      'authorization',
      'x-komisio-bridge',
      'x-forwarded-proto',
      'sec-websocket-protocol',
    ]
    const names = req.rawHeaders
      .filter((_value, index) => index % 2 === 0)
      .map((name) => name.toLowerCase())
    return (
      req.socket.remoteAddress === '127.0.0.1' &&
      req.method === 'GET' &&
      req.url === path &&
      req.headers.host === proxyHost &&
      req.headers['x-forwarded-proto'] === 'https' &&
      sensitive.every(
        (name) => names.filter((value) => value === name).length === 1,
      ) &&
      bytes.length === expectedSecret.length &&
      timingSafeEqual(bytes, expectedSecret)
    )
  }

  async function authenticate(operation) {
    let expired = false
    let timer
    const controller = new AbortController()
    authentication.add(controller)
    const pending = Promise.resolve()
      .then(() => operation(controller.signal))
      .then((handle) => {
        if (expired) {
          sessions.close(handle)
          throw denied()
        }
        return handle
      })
    try {
      return await Promise.race([
        pending,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true
            controller.abort()
            reject(denied())
          }, handshakeTimeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
      authentication.delete(controller)
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const protocol = req.headers['sec-websocket-protocol']
    if (
      closing ||
      upgrading ||
      !trusted(req) ||
      ![MAIN_PROTOCOL, RAW_PROTOCOL].includes(protocol)
    ) {
      socket.end(
        'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Komisio print"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      )
      return
    }
    upgrading = true
    const parent = main
    void (async () => {
      let handle
      try {
        if (protocol === RAW_PROTOCOL && (!parent?.requested || parent.raw))
          throw denied()
        handle = await authenticate((signal) =>
          protocol === MAIN_PROTOCOL
            ? sessions.openMain(req.headers.authorization, signal)
            : sessions.openRaw(
                parent.handle,
                req.headers.authorization,
                signal,
              ),
        )
        if (
          closing ||
          socket.destroyed ||
          (protocol === RAW_PROTOCOL && main !== parent)
        )
          throw denied()
        socket.setTimeout(0)
        const discard = () => sessions.close(handle)
        socket.once('close', discard)
        wss.handleUpgrade(req, socket, head, (ws) => {
          socket.off('close', discard)
          attach(ws, handle, protocol, parent)
        })
      } catch {
        if (handle) sessions.close(handle)
        socket.destroy()
      } finally {
        upgrading = false
      }
    })()
  })
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate()
      else {
        ws.alive = false
        ws.ping()
      }
    }
  }, heartbeatMs)
  heartbeat.unref()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch {
    clearInterval(heartbeat)
    wss.close()
    throw new Error('PRINT_SERVICE_UNAVAILABLE')
  }

  function runOnce() {
    if (closing || !main?.raw?.ready) return Promise.reject(denied())
    if (activeRun) return Promise.reject(new Error('PRINT_WORKER_BUSY'))
    const entry = main
    const raw = entry.raw
    const worker = createWeblinkQueueWorker({
      scope,
      rpc,
      journal,
      authorize: async (scope) =>
        main === entry &&
        entry.raw === raw &&
        raw.ready &&
        (await sessions.authorize(raw.handle, scope)),
      send: (bytes) => {
        if (main !== entry || entry.raw !== raw) return Promise.reject(denied())
        return send(raw.ws, bytes)
      },
    })
    activeRun = attempts.run(worker.run).finally(() => {
      activeRun = null
    })
    return activeRun
  }

  async function close() {
    closing = true
    for (const controller of authentication) controller.abort()
    clearInterval(heartbeat)
    closeMain(main)
    for (const socket of sockets) socket.destroy()
    await activeRun?.catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => wss.close(resolve))
    await attempts.close()
  }
  return Object.freeze({
    address: Object.freeze(server.address()),
    runOnce,
    close,
  })
}
