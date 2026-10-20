import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

export const MAIN = 'v1.weblink.zebra.com'
export const RAW = 'v1.raw.zebra.com'

/**
 * Loopback protocol experiment, never a hosted endpoint. The capability and
 * unique ID belong to a synthetic fixture, not a tenant or a printer identity.
 * A physical printer needs TLS, durable pairing and an authenticated queue
 * adapter before this can become a real bridge; see PRINT-AGENT.md.
 */
export async function startWeblinkExperiment({
  uniqueId = 'SYNTHETIC-PRINTER',
  handshakeMs = 5000,
} = {}) {
  const capability = randomBytes(32).toString('hex')
  let main = null
  let raw = null
  let revoked = false
  let discovery = false
  let rawOpened = false
  let reachable = false
  let lastStatus = null
  const jobs = new Map()
  const server = createServer((_request, response) => {
    response.writeHead(404).end()
  })
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.size === 1 && (protocols.has(MAIN) || protocols.has(RAW))
        ? protocols.values().next().value
        : false,
  })
  sockets.on('headers', (headers) => headers.push('Content-Length: 0'))
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const supplied = Buffer.from(url.searchParams.get('fixture') ?? '')
    const allowed =
      !revoked &&
      url.pathname === '/weblink/' &&
      supplied.length === capability.length &&
      timingSafeEqual(supplied, Buffer.from(capability)) &&
      [MAIN, RAW].includes(request.headers['sec-websocket-protocol'])
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const isMain = ws.protocol === MAIN
      if ((isMain && main) || (!isMain && (!main || !rawOpened || raw))) {
        ws.close(1008, 'Unexpected channel')
        return
      }
      if (isMain) {
        main = ws
        discovery = false
        rawOpened = false
      } else raw = ws
      let identified = false
      const timeout = setTimeout(
        () => ws.close(1008, 'Handshake timeout'),
        handshakeMs,
      )
      timeout.unref()
      ws.on('error', () => {
        // No peer-supplied text, URL or capability is logged.
      })
      ws.on('close', () => {
        clearTimeout(timeout)
        if (main === ws) {
          main = null
          discovery = false
          rawOpened = false
          raw?.close(1001, 'Main channel lost')
        }
        if (raw === ws) raw = null
        reachable = false
        for (const job of jobs.values())
          if (job.state === 'submitted') job.state = 'outcome_unknown'
      })
      ws.on('message', (bytes, binary) => {
        if (!binary) {
          ws.close(1003, 'Binary frames required')
          return
        }
        if (identified && !isMain) {
          // Transport evidence only: a status response does not prove a label
          // physically printed. Full ~HS parsing is a hardware follow-up.
          lastStatus = Buffer.from(bytes).toString('utf8').slice(0, 2048)
          reachable = true
          return
        }
        try {
          const message = JSON.parse(Buffer.from(bytes).toString('utf8'))
          if (isMain) {
            if (identified) return // Unsolicited alerts are ignored in the spike.
            if (
              typeof message.discovery_b64 !== 'string' ||
              !/^[A-Za-z0-9+/]+={0,2}$/.test(message.discovery_b64)
            )
              throw new Error('Invalid discovery')
            discovery = true
            rawOpened = true
            identified = true
            clearTimeout(timeout)
            ws.send(Buffer.from(JSON.stringify({ open: RAW })), {
              binary: true,
            })
          } else {
            if (
              !discovery ||
              message.unique_id !== uniqueId ||
              message.channel_name !== RAW ||
              typeof message.channel_id !== 'string'
            )
              throw new Error('Invalid raw identity')
            identified = true
            clearTimeout(timeout)
            ws.send(Buffer.from('~HS\r\n'), { binary: true })
          }
        } catch {
          ws.close(1008, 'Invalid handshake')
        }
      })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    url: `ws://127.0.0.1:${port}/weblink/?fixture=${capability}`,
    snapshot: () => ({
      discovery,
      reachable,
      revoked,
      lastStatus,
      jobs: Array.from(jobs, ([id, job]) => ({ id, ...job })),
    }),
    async submit({ id, payload, copies = 1 }) {
      if (jobs.has(id)) throw new Error('ALREADY_ATTEMPTED')
      if (revoked || !reachable || raw?.readyState !== WebSocket.OPEN)
        throw new Error('PRINTER_UNAVAILABLE')
      if (
        typeof id !== 'string' ||
        !id ||
        typeof payload !== 'string' ||
        !payload.startsWith('^XA') ||
        !payload.endsWith('^XZ') ||
        Buffer.byteLength(payload) > 80000 ||
        !Number.isInteger(copies) ||
        copies < 1 ||
        copies > 20
      )
        throw new Error('INVALID_JOB')
      // Repeat the already-rendered program exactly, like the existing TCP
      // agent. Do not rewrite its ZPL or insert a second competing ^PQ command.
      const job = { state: 'submitted', copies }
      jobs.set(id, job)
      try {
        for (let copy = 0; copy < copies; copy++)
          await new Promise((resolve, reject) =>
            raw.send(Buffer.from(payload), { binary: true }, (error) =>
              error ? reject(error) : resolve(),
            ),
          )
      } catch {
        job.state = 'outcome_unknown'
        throw new Error('PRINT_OUTCOME_UNKNOWN')
      }
    },
    revoke() {
      revoked = true
      reachable = false
      for (const socket of sockets.clients) socket.close(1008, 'Revoked')
    },
    async close() {
      revoked = true
      for (const socket of sockets.clients) socket.terminate()
      await new Promise((resolve) => sockets.close(resolve))
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
