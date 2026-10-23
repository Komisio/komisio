import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { rootCertificates } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import {
  createPrinterSessions,
  issuePrinterCredential,
} from '../../scripts/print-bridge/auth.mjs'
import {
  createWeblinkService,
  MAIN_PROTOCOL,
  RAW_PROTOCOL,
} from '../../scripts/print-bridge/service.mjs'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'
import { createAttemptStore } from '../../scripts/print-bridge/attempts.mjs'
import { createManagedWeblink } from '../../scripts/print-bridge/managed.mjs'
import { createEnrollmentStore } from '../../scripts/print-bridge/enrollment-store.mjs'

const tenantId = '10000000-0000-4000-8000-000000000001'
const printerId = '20000000-0000-4000-8000-000000000001'
const deviceId = '30000000-0000-4000-8000-000000000001'
const binding = { tenantId, printerId }

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weblink-managed-'))
  const encryptionKey = randomBytes(32)
  const proxySecret = randomBytes(32).toString('base64url')
  const managementSecret = randomBytes(32).toString('base64url')
  let enrollments = 0,
    starts = 0,
    stops = 0
  const password = randomBytes(32).toString('base64url')
  const config = {
    directory: join(root, 'state'),
    encryptionKey,
    proxySecret,
    managementSecret,
    caBundle: rootCertificates.find((pem) => {
      const cert = new X509Certificate(pem)
      return (
        cert.ca &&
        Date.parse(cert.validFrom) < Date.now() &&
        Date.parse(cert.validTo) > Date.now()
      )
    }),
    host: 'print.example.com',
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_test',
    enroll: async (input) => {
      enrollments++
      const store = await createEnrollmentStore(input.directory, encryptionKey)
      try {
        await store.save({
          phase: 'complete',
          deviceId,
          password,
          binding: {
            tenantId: input.tenantId,
            printerId: input.printerId,
            url: 'https://example.supabase.co/',
            publishableKey: 'sb_publishable_test',
          },
        })
      } finally {
        await store.close()
      }
      return { ...input, deviceId, password }
    },
    start: async () => {
      starts++
      return {
        address: { port: 9 },
        close: async () => {
          stops++
        },
      }
    },
    poll: async ({ service, signal }) => {
      if (!signal.aborted)
        await new Promise((resolve) =>
          signal.addEventListener('abort', resolve, { once: true }),
        )
      await service.close()
    },
    ...options,
  }
  let gateway = await createManagedWeblink(config)
  t.after(async () => {
    await gateway.close()
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('weblink-managed-'))
    await rm(root, { recursive: true, force: true })
  })
  return {
    address: () => gateway.address,
    config,
    password,
    counts: () => ({ enrollments, starts, stops }),
    restart: async (changes = {}) => {
      await gateway.close()
      gateway = await createManagedWeblink({ ...config, ...changes })
    },
    call: (action, data = binding, headers = {}) =>
      new Promise((resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${gateway.address.port}/manage/${action}`,
          {
            method: 'POST',
            headers: {
              host: config.host,
              'x-forwarded-proto': 'https',
              'x-komisio-bridge': proxySecret,
              authorization: `Bearer ${managementSecret}`,
              'Content-Type': 'application/json',
              ...headers,
            },
          },
          (res) => {
            let body = ''
            res.on('data', (chunk) => {
              body += chunk
            })
            res.on('end', () =>
              resolve({ status: res.statusCode, data: JSON.parse(body) }),
            )
            res.on('error', reject)
          },
        )
        req.on('error', reject)
        req.end(JSON.stringify(data))
      }),
  }
}

test('managed gateway requires both server and proxy authorization; browser origin is refused', async (t) => {
  const f = await fixture(t)
  for (const headers of [
    { authorization: 'Bearer wrong' },
    { 'x-komisio-bridge': 'wrong' },
    { host: 'other.example.com' },
    { 'x-forwarded-proto': 'http' },
    { origin: 'https://print.example.com' },
  ]) {
    assert.equal((await f.call('lookup', binding, headers)).status, 403)
  }
  assert.deepEqual((await f.call('lookup')).data, {
    state: 'absent',
    deviceId: null,
  })
  assert.equal(f.counts().enrollments, 0)
})

test(
  'two printers in one store keep authenticated channels and queue payloads isolated',
  { timeout: 10000 },
  async (t) => {
    const credentials = new Map(),
      services = new Map()
    const f = await fixture(t, {
      enroll: async (input) => {
        const id =
          input.printerId === printerId
            ? deviceId
            : '30000000-0000-4000-8000-000000000002'
        const record = { ...input, deviceId: id, ...issuePrinterCredential() }
        credentials.set(id, record)
        return record
      },
      start: async (config) => {
        const scope = config.scope
        const service = await createWeblinkService({
          ...config,
          sessions: createPrinterSessions({
            lookupCredential: async (id) => credentials.get(id),
            authorizeDevice: async () => true,
          }),
          journal: await createDispatchJournal(
            join(config.directory, '..', 'journal'),
          ),
          attempts: await createAttemptStore(
            join(config.directory, '..', 'attempts'),
            scope,
          ),
          rpc: async (name, args) =>
            name.startsWith('claim')
              ? {
                  jobId: scope.printerId,
                  attemptId: args.p_attempt,
                  state: 'dispatching',
                  canSend: true,
                  payload: `^XA^FD${scope.printerId}^FS^XZ`,
                  copies: 1,
                }
              : scope.printerId,
        })
        services.set(scope.deviceId, service)
        return service
      },
    })
    const second = '20000000-0000-4000-8000-000000000002'
    for (const id of [printerId, second])
      assert.equal(
        (
          await f.call('enroll', {
            tenantId,
            printerId: id,
            name: 'Zebra',
            code: 'AAAAA-BBBBB',
          })
        ).status,
        200,
      )
    async function connect(id, password, protocol = MAIN_PROTOCOL) {
      const socket = new WebSocket(
        `ws://127.0.0.1:${f.address().port}/weblink/${id}`,
        protocol,
        {
          headers: {
            Host: f.config.host,
            'X-Forwarded-Proto': 'https',
            'X-Komisio-Bridge': f.config.proxySecret,
            Authorization: `Basic ${Buffer.from(`${id}:${password}`).toString('base64')}`,
          },
        },
      )
      socket.on('error', () => {})
      t.after(() => socket.terminate())
      await once(socket, 'open')
      return socket
    }
    const devices = [...credentials.values()]
    await assert.rejects(connect(devices[0].deviceId, devices[1].password))
    await assert.rejects(connect(devices[1].deviceId, devices[0].password))
    const outputs = new Map()
    for (const record of devices) {
      const main = await connect(record.deviceId, record.password)
      const ready = once(main, 'message')
      main.send(Buffer.from('{"discovery_b64":"VEVTVA==:d767"}'))
      await ready
      const raw = await connect(record.deviceId, record.password, RAW_PROTOCOL)
      outputs.set(record.deviceId, [])
      raw.on('message', (bytes) =>
        outputs.get(record.deviceId).push(bytes.toString()),
      )
      raw.send(
        Buffer.from(
          JSON.stringify({
            unique_id: 'fixture',
            channel_name: RAW_PROTOCOL,
            channel_id: '2',
          }),
        ),
      )
      const pong = once(raw, 'pong')
      raw.ping()
      await pong
    }
    for (const record of devices) {
      assert.equal(
        (await services.get(record.deviceId).runOnce()).state,
        'transport_accepted',
      )
      for (let n = 0; n < 50 && !outputs.get(record.deviceId).length; n++)
        await new Promise((r) => setTimeout(r, 10))
      assert.deepEqual(outputs.get(record.deviceId), [
        `^XA^FD${record.printerId}^FS^XZ`,
      ])
    }
  },
)

test('repeated setup reuses one identity; configuration remains scoped and restart reopens that instance', async (t) => {
  const f = await fixture(t)
  const input = { ...binding, name: 'Shop Zebra', code: 'AAAAA-BBBBB' }
  assert.equal((await f.call('enroll', input)).data.state, 'ready')
  assert.equal((await f.call('enroll', input)).data.deviceId, deviceId)
  assert.equal(f.counts().enrollments, 1)
  const config = await f.call('configuration', { ...binding, deviceId })
  assert.equal(config.status, 200)
  assert.ok(config.data.configuration.includes(f.password))
  assert.equal(
    (await f.call('configuration', { ...binding, deviceId: printerId })).status,
    409,
  )
  assert.equal(
    (await f.call('lookup', { ...binding, tenantId: printerId })).status,
    409,
  )
  await f.restart()
  assert.equal((await f.call('lookup')).data.state, 'ready')
  assert.deepEqual(f.counts(), { enrollments: 1, starts: 2, stops: 1 })
})

test('capacity and replacement CAS cannot silently create another device', async (t) => {
  const f = await fixture(t, { capacity: 1 })
  await f.call('enroll', { ...binding, name: 'Zebra', code: 'AAAAA-BBBBB' })
  assert.equal(
    (
      await f.call('enroll', {
        ...binding,
        printerId: tenantId,
        name: 'Other',
        code: 'AAAAA-BBBBB',
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await f.call('enroll', {
        ...binding,
        replaceDeviceId: printerId,
        name: 'Zebra',
        code: 'AAAAA-BBBBB',
      })
    ).status,
    409,
  )
  assert.equal(f.counts().enrollments, 1)
  assert.equal(
    (
      await f.call('enroll', {
        ...binding,
        replaceDeviceId: deviceId,
        name: 'Zebra',
        code: 'AAAAA-BBBBB',
      })
    ).status,
    200,
  )
  assert.equal(f.counts().enrollments, 2)
  assert.equal(f.counts().stops, 1)
})

test('an existing registry cannot be repointed to another environment or host', async (t) => {
  const f = await fixture(t)
  await f.call('enroll', { ...binding, name: 'Zebra', code: 'AAAAA-BBBBB' })
  await assert.rejects(
    f.restart({ url: 'https://other.supabase.co' }),
    /REGISTRY/,
  )
  await assert.rejects(f.restart({ host: 'other.example.com' }), /REGISTRY/)
  assert.equal(f.counts().enrollments, 1)
})

test('failed worker startup holds the existing identity and never enrolls again on retry', async (t) => {
  const f = await fixture(t, {
    start: async () => {
      throw new Error('storage unavailable')
    },
  })
  const input = { ...binding, name: 'Zebra', code: 'AAAAA-BBBBB' }
  assert.equal((await f.call('enroll', input)).status, 409)
  assert.deepEqual((await f.call('lookup')).data, { state: 'held', deviceId })
  assert.equal((await f.call('enroll', input)).data.state, 'held')
  assert.equal(f.counts().enrollments, 1)
  await f.restart()
  assert.equal((await f.call('lookup')).data.state, 'held')
})

test('a stalled enrollment is bounded, lookup exposes pending and duplicate writes are refused', async (t) => {
  let resume
  const waiting = new Promise((resolve) => {
    resume = resolve
  })
  const f = await fixture(t, {
    enroll: async () => {
      await waiting
      throw new Error('unknown')
    },
  })
  const first = f.call('enroll', {
    ...binding,
    name: 'Zebra',
    code: 'AAAAA-BBBBB',
  })
  for (
    let i = 0;
    i < 50 && (await f.call('lookup')).data.state !== 'pending';
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(
    (await f.call('enroll', { ...binding, name: 'Zebra', code: 'AAAAA-BBBBB' }))
      .status,
    409,
  )
  resume()
  assert.equal((await first).status, 409)
  assert.equal((await f.call('lookup')).data.state, 'pending')
})
