import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import {
  createDeviceAuthorizer,
  createPrinterSessions,
  issuePrinterCredential,
} from '../../scripts/print-bridge/auth.mjs'

const scope = Object.freeze({
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
})
const other = Object.freeze({
  ...scope,
  deviceId: '30000000-0000-4000-8000-000000000004',
})
const basic = (id, password) =>
  `Basic ${Buffer.from(`${id}:${password}`).toString('base64')}`
const refusal = { message: 'PRINT_DEVICE_UNAUTHORIZED' }
function setup() {
  const credential = issuePrinterCredential()
  const state = {
    record: { ...scope, secretDigest: credential.secretDigest },
    allowed: true,
  }
  const sessions = createPrinterSessions({
    lookupCredential: async () => state.record,
    authorizeDevice: async () => state.allowed,
  })
  return { sessions, state, header: basic(scope.deviceId, credential.password) }
}

test('only matching independently authenticated main and raw channels authorize the bound device', async () => {
  const { sessions, header } = setup()
  const main = await sessions.openMain(header)
  const raw = await sessions.openRaw(main, header)
  assert.equal(await sessions.authorize(raw, scope), true)
  assert.equal(await sessions.authorize(main, scope), false)
  assert.equal(await sessions.authorize({}, scope), false)
  for (const key of ['tenantId', 'printerId', 'deviceId'])
    assert.equal(
      await sessions.authorize(raw, { ...scope, [key]: other.deviceId }),
      false,
    )
  await assert.rejects(sessions.openRaw(main, header), refusal)
})

test('missing, malformed, duplicated, guessed and serial-only credentials are denied', async () => {
  const { sessions, header } = setup()
  for (const invalid of [
    undefined,
    [header, header],
    '',
    'Basic !!!',
    `${header}, ${header}`,
    'Basic YQ==',
    basic(scope.deviceId, 'a'.repeat(43)),
    basic('serial-number', 'a'.repeat(43)),
    `${header}\n`,
  ])
    await assert.rejects(sessions.openMain(invalid), refusal)
  const main = await sessions.openMain(header)
  await assert.rejects(
    sessions.openRaw(main, basic(other.deviceId, 'a'.repeat(43))),
    refusal,
  )
  await assert.rejects(sessions.openRaw(main, undefined), refusal)
  await assert.rejects(sessions.openRaw({}, header), refusal)
})

test('pending greetings cannot authorize, bind twice or revive an obsolete main', async () => {
  const { sessions, header } = setup()
  const pendingMain = await sessions.openPending(header)
  assert.equal(await sessions.authorize(pendingMain, scope), false)
  const main = sessions.bindMain(pendingMain)
  assert.throws(() => sessions.bindMain(pendingMain), refusal)
  const pendingRaw = await sessions.openPending(header)
  assert.equal(await sessions.authorize(pendingRaw, scope), false)
  const raw = sessions.bindRaw(pendingRaw, main)
  assert.equal(await sessions.authorize(raw, scope), true)
  const duplicate = await sessions.openPending(header)
  assert.throws(() => sessions.bindRaw(duplicate, main), refusal)
  const stale = await sessions.openPending(header)
  const current = await sessions.openMain(header)
  assert.throws(() => sessions.bindRaw(stale, main), refusal)
  assert.throws(() => sessions.bindRaw(stale, current), refusal)
  const aborted = new AbortController()
  const late = await sessions.openPending(header, aborted.signal)
  aborted.abort()
  assert.throws(() => sessions.bindMain(late), refusal)
})

test('pending raw credentials cannot bind across a scope change or rotation', async () => {
  for (const change of [
    (state) => {
      state.record.printerId = other.deviceId
    },
    (state) => {
      state.record.tenantId = other.deviceId
    },
  ]) {
    const { sessions, header, state } = setup()
    const main = await sessions.openMain(header)
    change(state)
    const pending = await sessions.openPending(header)
    assert.throws(() => sessions.bindRaw(pending, main), refusal)
  }
  const { sessions, header, state } = setup()
  const main = await sessions.openMain(header)
  const next = issuePrinterCredential()
  state.record.secretDigest = next.secretDigest
  const rotated = await sessions.openPending(
    basic(scope.deviceId, next.password),
  )
  assert.throws(() => sessions.bindRaw(rotated, main), refusal)
})

test('reconnection retires the old generation and closing old handles cannot close the new one', async () => {
  const { sessions, header } = setup()
  const oldMain = await sessions.openMain(header)
  const oldRaw = await sessions.openRaw(oldMain, header)
  const newMain = await sessions.openMain(header)
  const newRaw = await sessions.openRaw(newMain, header)
  assert.equal(await sessions.authorize(oldRaw, scope), false)
  await assert.rejects(sessions.openRaw(oldMain, header), refusal)
  sessions.close(oldMain)
  sessions.close(oldRaw)
  assert.equal(await sessions.authorize(newRaw, scope), true)
  sessions.close(newRaw)
  assert.equal(await sessions.authorize(newRaw, scope), false)
  const replacement = await sessions.openRaw(newMain, header)
  sessions.close(newMain)
  assert.equal(await sessions.authorize(replacement, scope), false)
})

test('revocation, credential rotation, rebinding, missing storage and provider failure fail closed', async () => {
  for (const change of [
    (state) => {
      state.allowed = false
    },
    (state) => {
      state.record.secretDigest = issuePrinterCredential().secretDigest
    },
    (state) => {
      state.record.printerId = other.deviceId
    },
    (state) => {
      state.record = null
    },
  ]) {
    const { sessions, state, header } = setup()
    const main = await sessions.openMain(header)
    const raw = await sessions.openRaw(main, header)
    change(state)
    assert.equal(await sessions.authorize(raw, scope), false)
    await assert.rejects(sessions.openRaw(main, header), refusal)
  }
  const sessions = createPrinterSessions({
    lookupCredential: async () => {
      throw Error('sensitive token')
    },
  })
  await assert.rejects(sessions.openMain(setup().header), refusal)
})

test('disconnect during asynchronous authorization or raw opening cannot resurrect the session', async () => {
  const credential = issuePrinterCredential()
  let wait = null
  let started
  const sessions = createPrinterSessions({
    lookupCredential: async () => ({ ...scope, ...credential }),
    authorizeDevice: async () => {
      started?.()
      if (wait) await wait
      return true
    },
  })
  const header = basic(scope.deviceId, credential.password)
  const main = await sessions.openMain(header)
  const raw = await sessions.openRaw(main, header)
  let release
  wait = new Promise((resolve) => {
    release = resolve
  })
  const entered = new Promise((resolve) => {
    started = resolve
  })
  const authorization = sessions.authorize(raw, scope)
  await entered
  sessions.close(main)
  release()
  assert.equal(await authorization, false)
  wait = null
  const nextMain = await sessions.openMain(header)
  wait = new Promise((resolve) => {
    release = resolve
  })
  const enteredAgain = new Promise((resolve) => {
    started = resolve
  })
  const opening = sessions.openRaw(nextMain, header)
  await enteredAgain
  sessions.close(nextMain)
  release()
  await assert.rejects(opening, refusal)
})

test('concurrent raw handshakes admit only one channel', async () => {
  const { sessions, header } = setup()
  const main = await sessions.openMain(header)
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => sessions.openRaw(main, header)),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
})

test('device authorizer uses the bounded device RPC and never follows credential-bearing redirects', async (t) => {
  const requests = []
  let status = 200
  let context = { ...scope, transport: 'weblink', active: true }
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({
      url: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body,
    })
    res.writeHead(
      status,
      status === 302
        ? { Location: '/must-not-follow' }
        : { 'Content-Type': 'application/json' },
    )
    res.end(JSON.stringify(context))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(resolve)
      }),
  )
  const authorize = createDeviceAuthorizer({
    url: `http://127.0.0.1:${server.address().port}`,
    publishableKey: 'sb_publishable_local_fixture',
    getAccessToken: async (binding) => {
      assert.deepEqual(binding, scope)
      return 'local-fixture-device-token'
    },
  })
  assert.equal(await authorize(scope), true)
  context = { ...scope, transport: 'weblink', active: false }
  assert.equal(await authorize(scope), false)
  context = { ...other, transport: 'weblink', active: true }
  assert.equal(await authorize(scope), false)
  for (const transport of ['tcp', 'usb', undefined]) {
    context = { ...scope, transport, active: true }
    assert.equal(await authorize(scope), false)
  }
  context = { ...scope, transport: 'weblink', active: true }
  status = 401
  assert.equal(await authorize(scope), false)
  status = 302
  assert.equal(await authorize(scope), false)
  assert.equal(requests.length, 8)
  for (const request of requests)
    assert.deepEqual(request, {
      url: '/rest/v1/rpc/print_device_context',
      method: 'POST',
      authorization: 'Bearer local-fixture-device-token',
      body: '{}',
    })
})

test('authorizer rejects insecure remote endpoints, token failures and untrusted responses', async () => {
  for (const publishableKey of [
    'sb_secret_do_not_use',
    `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`,
  ])
    assert.throws(() =>
      createDeviceAuthorizer({ url: 'https://example.com', publishableKey }),
    )
  for (const url of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com/?secret=token',
    'https://example.com/#token',
  ])
    assert.throws(() =>
      createDeviceAuthorizer({ url, publishableKey: 'sb_publishable_fixture' }),
    )
  for (const fetchImpl of [
    async () => {
      throw Error('token in provider error')
    },
    async () => new Response('not json'),
    async () => Response.json(null),
    async () =>
      Response.json({
        ...scope,
        transport: 'weblink',
        active: true,
        oversized: 'x'.repeat(17000),
      }),
  ]) {
    const authorize = createDeviceAuthorizer({
      url: 'https://example.com',
      publishableKey: 'sb_publishable_fixture',
      getAccessToken: async () => 'fixture',
      fetchImpl,
    })
    assert.equal(await authorize(scope), false)
  }
  const authorize = createDeviceAuthorizer({
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    getAccessToken: async () => {
      throw Error('refresh secret')
    },
    fetchImpl: () => assert.fail('must not fetch'),
  })
  assert.equal(await authorize(scope), false)
})
