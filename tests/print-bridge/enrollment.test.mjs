import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
  unlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { enrollWeblinkDevice } from '../../scripts/print-bridge/enrollment.mjs'
import { createEnrollmentStore } from '../../scripts/print-bridge/enrollment-store.mjs'
import { createCredentialStore } from '../../scripts/print-bridge/credentials.mjs'
import { createAttemptStore } from '../../scripts/print-bridge/attempts.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const userId = '40000000-0000-4000-8000-000000000004'
const session = (number) => ({
  access_token: `access-${number}`,
  refresh_token: `refresh-${number}`,
  user: { id: userId, is_anonymous: true },
})
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'komisio-enroll-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-enroll-'))
    await rm(root, { recursive: true, force: true })
  })
  const config = {
    directory: join(root, 'enrollment'),
    encryptionKey: randomBytes(32),
    ...scope,
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    deviceName: 'Fixture Zebra',
    pairingCode: 'A1234-B5678',
  }
  const calls = []
  let paired = false,
    tokens = 0
  const fetchImpl = async (url, request) => {
    const path = new URL(url).pathname
    calls.push(path)
    assert.equal(request.redirect, 'error')
    if (path === '/auth/v1/signup') return Response.json(session(++tokens))
    if (path === '/auth/v1/token') return Response.json(session(++tokens))
    assert.equal(request.headers.Authorization, `Bearer access-${tokens}`)
    if (path.endsWith('/pair_print_device')) {
      assert.equal(paired, false, 'pairing must never be replayed')
      assert.equal(JSON.parse(request.body).p_code, 'A1234B5678')
      paired = true
      return Response.json(scope)
    }
    assert.ok(path.endsWith('/print_device_context'))
    return paired
      ? Response.json({ ...scope, transport: 'weblink', active: false })
      : new Response('{}', { status: 403 })
  }
  return { config: { ...config, fetchImpl }, calls, fetchImpl }
}

test('enrollment publishes encrypted device credentials and completed replay never repeats Auth or pairing', async (t) => {
  const { config, calls } = await setup(t)
  const result = await enrollWeblinkDevice(config)
  assert.equal(result.deviceId, scope.deviceId)
  assert.equal(calls.length, 3)
  const sealed = await readFile(
    join(config.directory, 'enrollment.sealed'),
    'utf8',
  )
  for (const secret of [
    result.password,
    'refresh-1',
    'access-1',
    config.pairingCode,
    'A1234B5678',
  ])
    assert.ok(!sealed.includes(secret))
  const credentials = await createCredentialStore(
    result.directory,
    config.encryptionKey,
  )
  const record = await credentials.load(scope.deviceId)
  assert.equal(record.refreshToken, 'refresh-1')
  assert.equal(
    record.secretDigest,
    createHash('sha256').update(result.password).digest('hex'),
  )
  await credentials.save(
    { ...record, refreshToken: 'runtime-rotated' },
    record.revision,
  )
  assert.deepEqual(
    await enrollWeblinkDevice({ ...config, pairingCode: undefined }),
    result,
  )
  assert.equal(
    (await credentials.load(scope.deviceId)).refreshToken,
    'runtime-rotated',
  )
  assert.equal(calls.length, 3)
})

test('a consumed pairing code with a lost reply recovers the same identity by context read only', async (t) => {
  const { config, calls, fetchImpl } = await setup(t)
  let fail = true
  config.fetchImpl = async (url, request) => {
    const response = await fetchImpl(url, request)
    if (new URL(url).pathname.endsWith('/pair_print_device') && fail) {
      fail = false
      throw Error('lost reply containing a private token')
    }
    return response
  }
  await assert.rejects(
    enrollWeblinkDevice(config),
    /PRINT_ENROLLMENT_REMOTE_UNKNOWN/,
  )
  const result = await enrollWeblinkDevice({
    ...config,
    pairingCode: undefined,
  })
  assert.equal(result.deviceId, scope.deviceId)
  assert.equal(
    calls.filter((path) => path.endsWith('/pair_print_device')).length,
    1,
  )
  assert.equal(calls.filter((path) => path.endsWith('/signup')).length, 1)
  const credentials = await createCredentialStore(
    result.directory,
    config.encryptionKey,
  )
  assert.equal(
    (await credentials.load(scope.deviceId)).refreshToken,
    'refresh-2',
  )
})

test('lost signup or refresh never causes another anonymous identity or token request', async (t) => {
  for (const phase of ['signup', 'refresh']) {
    const { config, calls, fetchImpl } = await setup(t)
    config.fetchImpl = async (url, request) => {
      const path = new URL(url).pathname
      const response = await fetchImpl(url, request)
      if (
        phase === 'signup' ||
        path.endsWith('/pair_print_device') ||
        path.endsWith('/token')
      )
        throw Error('uncertain request')
      return response
    }
    await assert.rejects(enrollWeblinkDevice(config))
    if (phase === 'refresh') await assert.rejects(enrollWeblinkDevice(config))
    const prior = calls.length
    await assert.rejects(
      enrollWeblinkDevice(config),
      /PRINT_ENROLLMENT_SESSION_UNKNOWN/,
    )
    assert.equal(calls.length, prior)
  }
})

test('a definitely unpaired context after an uncertain pair does not resubmit the code', async (t) => {
  const { config, calls, fetchImpl } = await setup(t)
  let pairCalls = 0
  config.fetchImpl = async (url, request) => {
    if (new URL(url).pathname.endsWith('/pair_print_device')) {
      pairCalls++
      throw Error('connection lost before database')
    }
    return fetchImpl(url, request)
  }
  await assert.rejects(enrollWeblinkDevice(config))
  await assert.rejects(
    enrollWeblinkDevice(config),
    /PRINT_ENROLLMENT_PAIRING_UNKNOWN/,
  )
  assert.equal(pairCalls, 1)
  assert.equal(calls.filter((path) => path.endsWith('/signup')).length, 1)
})

test('wrong store, printer, legacy transport or non-anonymous sessions cannot publish', async (t) => {
  for (const changed of [
    { tenantId: userId },
    { printerId: userId },
    { transport: 'tcp' },
    { transport: 'usb' },
    { deviceId: 'invalid' },
  ]) {
    const { config, fetchImpl } = await setup(t)
    config.fetchImpl = (url, request) =>
      new URL(url).pathname.endsWith('/print_device_context')
        ? Response.json({
            ...scope,
            transport: 'weblink',
            active: false,
            ...changed,
          })
        : fetchImpl(url, request)
    await assert.rejects(
      enrollWeblinkDevice(config),
      /PRINT_ENROLLMENT_BINDING_CONFLICT/,
    )
    await assert.rejects(
      readFile(join(config.directory, 'device', `${scope.deviceId}.sealed`)),
      { code: 'ENOENT' },
    )
  }
  const { config } = await setup(t)
  config.fetchImpl = async () =>
    Response.json({ ...session(1), user: { id: userId, is_anonymous: false } })
  await assert.rejects(
    enrollWeblinkDevice(config),
    /PRINT_ENROLLMENT_SESSION_UNKNOWN/,
  )
})

test('concurrent enrollment and runtime owners cannot overwrite credentials or change binding', async (t) => {
  const { config, calls } = await setup(t)
  const lock = await createEnrollmentStore(
    config.directory,
    config.encryptionKey,
  )
  await assert.rejects(enrollWeblinkDevice(config), /PRINT_ENROLLMENT_LOCKED/)
  assert.equal(calls.length, 0)
  await lock.close()
  const result = await enrollWeblinkDevice(config)
  await assert.rejects(
    enrollWeblinkDevice({ ...config, tenantId: userId }),
    /PRINT_ENROLLMENT_BINDING_CONFLICT/,
  )
  const owner = await createAttemptStore(
    join(result.directory, 'attempts'),
    scope,
  )
  await assert.rejects(
    enrollWeblinkDevice(config),
    /PRINT_ATTEMPT_STORE_LOCKED/,
  )
  await owner.close()
  assert.equal(calls.length, 3)
})

test('publication interrupted after credentials were saved retains the later rotated token', async (t) => {
  const { config } = await setup(t)
  const result = await enrollWeblinkDevice(config)
  const checkpoint = await createEnrollmentStore(
    config.directory,
    config.encryptionKey,
  )
  const state = await checkpoint.load()
  await checkpoint.save({
    ...state,
    phase: 'publishing',
    refreshToken: 'stale-enrollment-token',
  })
  await checkpoint.close()
  const credentials = await createCredentialStore(
    result.directory,
    config.encryptionKey,
  )
  const record = await credentials.load(scope.deviceId)
  await credentials.save(
    { ...record, refreshToken: 'new-runtime-token' },
    record.revision,
  )
  await enrollWeblinkDevice(config)
  assert.equal(
    (await credentials.load(scope.deviceId)).refreshToken,
    'new-runtime-token',
  )
})

test('wrong key and damaged enrollment evidence fail closed and retain a review lock', async (t) => {
  for (const corrupt of [false, true]) {
    const { config } = await setup(t)
    await enrollWeblinkDevice(config)
    if (corrupt)
      await writeFile(join(config.directory, 'enrollment.sealed'), '{')
    await assert.rejects(
      enrollWeblinkDevice({
        ...config,
        encryptionKey: corrupt ? config.encryptionKey : randomBytes(32),
      }),
      /PRINT_ENROLLMENT_STORAGE_UNAVAILABLE/,
    )
    await assert.rejects(enrollWeblinkDevice(config), /PRINT_ENROLLMENT_LOCKED/)
  }
})

test(
  'Linux enrollment storage refuses public state and keeps a lock after failed persistence',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { config } = await setup(t)
    const store = await createEnrollmentStore(
      config.directory,
      config.encryptionKey,
    )
    await chmod(config.directory, 0o500)
    await assert.rejects(
      store.save({ private: true }),
      /PRINT_ENROLLMENT_STORAGE_UNAVAILABLE/,
    )
    await chmod(config.directory, 0o700)
    await store.close()
    await assert.rejects(
      createEnrollmentStore(config.directory, config.encryptionKey),
      /PRINT_ENROLLMENT_LOCKED/,
    )
    await unlink(join(config.directory, 'enrollment.lock'))
    await chmod(config.directory, 0o755)
    await assert.rejects(
      createEnrollmentStore(config.directory, config.encryptionKey),
      /PRINT_ENROLLMENT_STORAGE_UNAVAILABLE/,
    )
  },
)

test(
  'Linux refuses to consume the pairing code if the anonymous session cannot be persisted',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { config, calls, fetchImpl } = await setup(t)
    config.fetchImpl = async (url, request) => {
      const response = await fetchImpl(url, request)
      if (new URL(url).pathname.endsWith('/signup'))
        await chmod(config.directory, 0o500)
      return response
    }
    try {
      await assert.rejects(
        enrollWeblinkDevice(config),
        /PRINT_ENROLLMENT_STORAGE_UNAVAILABLE/,
      )
    } finally {
      await chmod(config.directory, 0o700)
    }
    assert.equal(
      calls.some((path) => path.endsWith('/pair_print_device')),
      false,
    )
  },
)
