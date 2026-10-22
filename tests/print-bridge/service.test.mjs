import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { WebSocket } from 'ws'
import {
  createPrinterSessions,
  issuePrinterCredential,
} from '../../scripts/print-bridge/auth.mjs'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'
import { createAttemptStore } from '../../scripts/print-bridge/attempts.mjs'
import {
  createWeblinkService,
  MAIN_PROTOCOL,
  RAW_PROTOCOL,
} from '../../scripts/print-bridge/service.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const jobId = '50000000-0000-4000-8000-000000000005'
const payload = '^XA^FDRöd & blå^FS^XZ'
const basic = (password) =>
  `Basic ${Buffer.from(`${scope.deviceId}:${password}`).toString('base64')}`
const gate = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'komisio-service-'))
  const credential = issuePrinterCredential()
  const proxySecret = issuePrinterCredential().password
  const calls = []
  let allowed = true
  let authHook = async () => {}
  const sessions = createPrinterSessions({
    lookupCredential: async (id) =>
      id === scope.deviceId ? { ...scope, ...credential } : null,
    authorizeDevice: async () => {
      await authHook()
      return allowed
    },
  })
  const attempts = await createAttemptStore(join(root, 'attempts'), scope)
  const journal = await createDispatchJournal(join(root, 'journal'))
  let service
  t.after(async () => {
    await service?.close()
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-service-'))
    await rm(root, { recursive: true, force: true })
  })
  service = await createWeblinkService({
    scope,
    sessions,
    journal,
    attempts,
    proxyHost: 'print.example.com',
    proxySecret,
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (options.rpc) return options.rpc(name, args)
      return name.startsWith('claim')
        ? {
            jobId,
            attemptId: args.p_attempt,
            state: 'dispatching',
            canSend: true,
            payload,
            copies: 2,
          }
        : jobId
    },
    ...options.config,
  })
  const headers = {
    Host: 'print.example.com',
    'X-Forwarded-Proto': 'https',
    'X-Komisio-Bridge': proxySecret,
    Authorization: basic(credential.password),
  }
  const url = `ws://127.0.0.1:${service.address.port}/weblink/${scope.deviceId}`
  async function connect(protocol, changes = {}, suffix = '') {
    const ws = new WebSocket(url + suffix, protocol, {
      headers: { ...headers, ...changes },
      perMessageDeflate: false,
    })
    ws.on('error', () => {})
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }
  async function mainChannel(discoverySuffix = '') {
    const ws = await connect(MAIN_PROTOCOL)
    const request = once(ws, 'message')
    ws.send(
      Buffer.from(
        JSON.stringify({
          discovery_b64:
            Buffer.from('fixture metadata').toString('base64') +
            discoverySuffix,
        }),
      ),
    )
    const [bytes, binary] = await request
    assert.equal(binary, true)
    assert.deepEqual(JSON.parse(bytes), { open: RAW_PROTOCOL })
    return ws
  }
  async function pair(rawProtocol = RAW_PROTOCOL) {
    const main = await mainChannel()
    const raw = await connect(rawProtocol)
    raw.send(
      Buffer.from(
        JSON.stringify({
          unique_id: 'untrusted-serial',
          channel_name: RAW_PROTOCOL,
          channel_id: '2',
        }),
      ),
    )
    // A wire-order barrier after the greeting, without calling the queue early.
    const pong = once(raw, 'pong')
    raw.ping()
    await pong
    return { main, raw }
  }
  return {
    service,
    root,
    calls,
    connect,
    mainChannel,
    pair,
    revoke: () => {
      allowed = false
    },
    authHook: (hook) => {
      authHook = hook
    },
  }
}

test(
  'firmware raw greeting on the main subprotocol preserves the main channel and delivers exact copies',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    const { main, raw } = await f.pair(MAIN_PROTOCOL)
    assert.equal(f.service.status().connected, true)
    assert.equal(main.readyState, WebSocket.OPEN)
    let count = 0
    const delivered = gate()
    raw.on('message', () => {
      if (++count === 2) delivered.resolve()
    })
    assert.equal((await f.service.runOnce()).state, 'transport_accepted')
    await delivered.promise
    assert.equal(count, 2)
  },
)

test(
  'firmware discovery accepts a four-hex suffix without granting queue access',
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t)
    await f.mainChannel(':d767')
    assert.equal(f.service.status().connected, false)
    await assert.rejects(f.service.runOnce(), /PRINT_CHANNEL_UNAVAILABLE/)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'aliased raw greetings reject orphan, duplicate and stale-parent channels',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    const greet = (ws) =>
      ws.send(
        Buffer.from(
          JSON.stringify({
            channel_name: RAW_PROTOCOL,
            channel_id: '2',
            unique_id: 'untrusted',
          }),
        ),
      )
    const orphan = await f.connect(MAIN_PROTOCOL)
    let closed = once(orphan, 'close')
    greet(orphan)
    await closed
    await f.mainChannel()
    const stale = await f.connect(MAIN_PROTOCOL)
    const current = await f.pair(MAIN_PROTOCOL)
    closed = once(stale, 'close')
    greet(stale)
    await closed
    const duplicate = await f.connect(MAIN_PROTOCOL)
    closed = once(duplicate, 'close')
    greet(duplicate)
    await closed
    assert.equal(current.main.readyState, WebSocket.OPEN)
    assert.equal(current.raw.readyState, WebSocket.OPEN)
    assert.equal(f.service.status().connected, true)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'a pending main-protocol handshake times out without replacing a working pair',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, { config: { handshakeTimeoutMs: 250 } })
    const pair = await f.pair(MAIN_PROTOCOL)
    const pending = await f.connect(MAIN_PROTOCOL)
    await once(pending, 'close')
    assert.equal(f.service.status().connected, true)
    assert.equal(pair.main.readyState, WebSocket.OPEN)
    assert.equal(pair.raw.readyState, WebSocket.OPEN)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'real binary WebSocket frames reach the durable queue worker as exact copies',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    assert.equal(f.service.address.address, '127.0.0.1')
    await assert.rejects(f.service.runOnce(), /PRINT_CHANNEL_UNAVAILABLE/)
    const { raw } = await f.pair()
    const received = []
    const done = gate()
    raw.on('message', (bytes, binary) => {
      received.push({ bytes, binary })
      if (received.length === 2) done.resolve()
    })
    const result = await f.service.runOnce()
    await done.promise
    assert.equal(result.state, 'transport_accepted')
    assert.deepEqual(received, [
      { bytes: Buffer.from(payload), binary: true },
      { bytes: Buffer.from(payload), binary: true },
    ])
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[1].args.p_outcome, 'transport_accepted')
    const persisted = await readFile(
      join(f.root, 'attempts', 'current.json'),
      'utf8',
    )
    assert.ok(!persisted.includes(payload))
    assert.equal(JSON.parse(persisted).attemptId, f.calls[0].args.p_attempt)
  },
)

test(
  'proxy boundary, exact path, protocol and independent printer auth fail closed',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    for (const [protocol, headers, suffix] of [
      [MAIN_PROTOCOL, { 'X-Komisio-Bridge': 'bad' }, ''],
      [MAIN_PROTOCOL, { 'X-Forwarded-Proto': 'http' }, ''],
      [MAIN_PROTOCOL, { Host: 'other.example.com' }, ''],
      [MAIN_PROTOCOL, {}, '?password=not-supported'],
      ['unexpected', {}, ''],
      [
        MAIN_PROTOCOL,
        { Authorization: basic(issuePrinterCredential().password) },
        '',
      ],
      [RAW_PROTOCOL, {}, ''],
    ])
      await assert.rejects(f.connect(protocol, headers, suffix))
    const main = await f.mainChannel()
    await assert.rejects(
      f.connect(RAW_PROTOCOL, {
        Authorization: basic(issuePrinterCredential().password),
      }),
    )
    await assert.rejects(
      f.connect(MAIN_PROTOCOL, {
        Authorization: basic(issuePrinterCredential().password),
      }),
    )
    assert.equal(main.readyState, WebSocket.OPEN)
    await assert.rejects(f.service.runOnce(), /PRINT_CHANNEL_UNAVAILABLE/)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'a second raw connection cannot attach; replacing main closes old channels',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    const old = await f.pair()
    await assert.rejects(f.connect(RAW_PROTOCOL))
    const closed = once(old.raw, 'close')
    const fresh = await f.pair()
    await closed
    assert.equal(old.main.readyState, WebSocket.CLOSED)
    assert.equal(fresh.raw.readyState, WebSocket.OPEN)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'reconnect while claiming invalidates the old send permit instead of redirecting it',
  { timeout: 5000 },
  async (t) => {
    const claimed = gate(),
      release = gate()
    const f = await fixture(t, {
      rpc: async (name, args) => {
        if (name.startsWith('claim')) {
          claimed.resolve()
          await release.promise
          return {
            jobId,
            attemptId: args.p_attempt,
            state: 'dispatching',
            canSend: true,
            payload,
            copies: 2,
          }
        }
        return jobId
      },
    })
    const old = await f.pair()
    let sent = 0
    old.raw.on('message', () => sent++)
    const result = f.service.runOnce()
    await claimed.promise
    const fresh = await f.pair()
    fresh.raw.on('message', () => sent++)
    release.resolve()
    assert.equal((await result).state, 'outcome_unknown')
    assert.equal((await f.service.runOnce()).state, 'held')
    assert.equal(sent, 0)
    assert.equal(f.calls.length, 2)
  },
)

test(
  'revocation between copies preserves uncertainty and prevents the second write',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    const { raw } = await f.pair()
    let checks = 0
    const received = []
    const first = gate()
    raw.on('message', (bytes) => {
      received.push(bytes.toString())
      first.resolve()
    })
    f.authHook(async () => {
      checks++
      // worker preflight, journal preflight, first copy, then second copy.
      if (checks === 4) {
        await first.promise
        f.revoke()
      }
    })
    assert.equal((await f.service.runOnce()).state, 'outcome_unknown')
    assert.deepEqual(received, [payload])
    assert.equal(f.calls[1].args.p_outcome, 'outcome_unknown')
    assert.equal((await f.service.runOnce()).state, 'held')
  },
)

test(
  'lost claim response halts even with a fresh connection; no extra RPC or output',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, {
      rpc: async () => {
        throw Error('secret upstream response')
      },
    })
    await f.pair()
    const first = await f.service.runOnce()
    assert.equal(first.state, 'claim_unknown')
    await f.pair()
    assert.deepEqual(await f.service.runOnce(), {
      state: 'held',
      attemptId: first.attemptId,
    })
    assert.equal(f.calls.length, 1)
  },
)

test(
  'text, malformed discovery, malformed raw greeting and oversized frames never claim work',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t)
    for (const frame of [
      '{}',
      Buffer.from('{"discovery_b64":"?"}'),
      ...[':abcd:1234', ':abc', ':abcde', ':xyz1', ':', '\\n'].map((suffix) =>
        Buffer.from(JSON.stringify({ discovery_b64: 'Zm9v' + suffix })),
      ),
      Buffer.alloc(65537),
    ]) {
      const ws = await f.connect(MAIN_PROTOCOL)
      const closed = once(ws, 'close')
      ws.send(frame)
      await closed
    }
    await f.mainChannel()
    const raw = await f.connect(RAW_PROTOCOL)
    const closed = once(raw, 'close')
    raw.send(
      Buffer.from(
        JSON.stringify({
          unique_id: scope.deviceId,
          channel_name: MAIN_PROTOCOL,
          channel_id: '2',
        }),
      ),
    )
    await closed
    await assert.rejects(f.service.runOnce(), /PRINT_CHANNEL_UNAVAILABLE/)
    assert.equal(f.calls.length, 0)
  },
)

test(
  'late authentication cannot revive a timed-out upgrade',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, { config: { handshakeTimeoutMs: 250 } })
    const started = gate(),
      release = gate()
    f.authHook(async () => {
      started.resolve()
      await release.promise
    })
    const failed = assert.rejects(f.connect(MAIN_PROTOCOL))
    await started.promise
    await failed
    f.authHook(async () => {})
    await f.pair()
    release.resolve()
    // The late result must not invalidate the NEW authenticated generation.
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal((await f.service.runOnce()).state, 'transport_accepted')
  },
)

test(
  'shutdown drains an in-flight claim and fences every subsequent copy',
  { timeout: 5000 },
  async (t) => {
    const started = gate(),
      release = gate()
    const f = await fixture(t, {
      rpc: async (name, args) => {
        if (name.startsWith('claim')) {
          started.resolve()
          await release.promise
          return {
            jobId,
            attemptId: args.p_attempt,
            state: 'dispatching',
            canSend: true,
            payload,
            copies: 1,
          }
        }
        return jobId
      },
    })
    await f.pair()
    const run = f.service.runOnce()
    await started.promise
    await assert.rejects(f.service.runOnce(), /PRINT_WORKER_BUSY/)
    const stop = f.service.close()
    release.resolve()
    assert.equal((await run).state, 'outcome_unknown')
    await stop
    await assert.rejects(f.service.runOnce(), /PRINT_CHANNEL_UNAVAILABLE/)
  },
)
