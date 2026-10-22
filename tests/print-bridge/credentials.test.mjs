import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  copyFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createCredentialStore } from '../../scripts/print-bridge/credentials.mjs'
import {
  createPrinterSessions,
  createDeviceTokenProvider,
  issuePrinterCredential,
} from '../../scripts/print-bridge/auth.mjs'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const roots = []
const children = new Set()
afterEach(async () => {
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
    }),
  )
  children.clear()
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-print-auth-'))
    await rm(root, { recursive: true, force: true })
  }
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'komisio-print-auth-'))
  roots.push(root)
  const directory = join(root, 'credentials')
  const key = randomBytes(32)
  const store = await createCredentialStore(directory, key)
  const credential = issuePrinterCredential()
  const record = {
    ...scope,
    secretDigest: credential.secretDigest,
    refreshToken: 'synthetic-refresh-secret',
  }
  return {
    root,
    directory,
    key,
    store,
    record,
    credential,
    path: join(directory, `${scope.deviceId}.sealed`),
  }
}

test('independent processes serialize credential rotation with the same expected version', async () => {
  const { directory, key, store, record } = await setup()
  const revision = await store.save(record)
  const workers = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const child = fork(
        fileURLToPath(
          new URL('../fixtures/print-credential-worker.mjs', import.meta.url),
        ),
        [],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      )
      children.add(child)
      const ready = once(child, 'message')
      child.send({
        directory,
        key: key.toString('hex'),
        record: { ...record, refreshToken: `process-${index}` },
        revision,
      })
      assert.deepEqual((await ready)[0], { ready: true })
      return child
    }),
  )
  const results = await Promise.all(
    workers.map((child) => {
      const response = once(child, 'message').then(([message]) => message)
      child.send('save')
      return response
    }),
  )
  assert.equal(results.filter((result) => result.saved === true).length, 1)
  for (const result of results.filter((result) => !result.saved))
    assert.ok(
      ['PRINT_CREDENTIAL_BUSY', 'PRINT_CREDENTIAL_CONFLICT'].includes(
        result.code,
      ),
    )
})

test('credentials survive restart encrypted, preserve binding and reject stale rotations', async () => {
  const { directory, key, store, record, path, credential } = await setup()
  assert.equal(await store.load(scope.deviceId), null)
  await assert.rejects(
    store.save({ ...record, refreshToken: '\u0001'.repeat(8192) }),
    { code: 'INVALID_PRINT_CREDENTIAL' },
  )
  const revision = await store.save(record)
  const disk = await readFile(path, 'utf8')
  for (const secret of [
    record.refreshToken,
    record.secretDigest,
    credential.password,
    scope.tenantId,
  ])
    assert.ok(!disk.includes(secret))
  const restarted = await createCredentialStore(directory, key)
  assert.deepEqual(await restarted.load(scope.deviceId), {
    ...record,
    revision,
  })
  const next = await restarted.save(
    { ...record, refreshToken: 'rotated-secret' },
    revision,
  )
  assert.notEqual(next, revision)
  await assert.rejects(store.save(record, revision), {
    code: 'PRINT_CREDENTIAL_CONFLICT',
  })
  await assert.rejects(
    store.save({ ...record, tenantId: scope.printerId }, next),
    { code: 'PRINT_CREDENTIAL_CONFLICT' },
  )
  assert.equal(
    (await restarted.load(scope.deviceId)).refreshToken,
    'rotated-secret',
  )
})

test('wrong key, altered authentication tag and moving a record to another device fail closed', async () => {
  const { directory, store, record, path } = await setup()
  await store.save(record)
  const wrongKey = await createCredentialStore(directory, randomBytes(32))
  await assert.rejects(wrongKey.load(scope.deviceId), {
    code: 'PRINT_CREDENTIAL_UNAVAILABLE',
  })
  await copyFile(path, join(directory, `${scope.printerId}.sealed`))
  await assert.rejects(store.load(scope.printerId), {
    code: 'PRINT_CREDENTIAL_UNAVAILABLE',
  })
  const original = await readFile(path, 'utf8')
  const changed = JSON.parse(original)
  changed.tag =
    changed.tag[0] === '0'
      ? '1' + changed.tag.slice(1)
      : '0' + changed.tag.slice(1)
  await writeFile(path, JSON.stringify(changed))
  await assert.rejects(store.load(scope.deviceId), {
    code: 'PRINT_CREDENTIAL_UNAVAILABLE',
  })
  await assert.rejects(store.save(record), {
    code: 'PRINT_CREDENTIAL_UNAVAILABLE',
  })
  assert.notEqual(await readFile(path, 'utf8'), original)
})

test('competing storage instances cannot overwrite a committed credential version', async () => {
  const { directory, key, store, record } = await setup()
  const revision = await store.save(record)
  const instances = await Promise.all(
    Array.from({ length: 6 }, () => createCredentialStore(directory, key)),
  )
  const results = await Promise.allSettled(
    instances.map((instance, index) =>
      instance.save({ ...record, refreshToken: `rotation-${index}` }, revision),
    ),
  )
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  for (const result of results.filter((result) => result.status === 'rejected'))
    assert.ok(
      ['PRINT_CREDENTIAL_BUSY', 'PRINT_CREDENTIAL_CONFLICT'].includes(
        result.reason.code,
      ),
    )
})

test('a leftover writer lock blocks automatic recovery; invalid identifiers cannot escape storage', async () => {
  const { store, record, path } = await setup()
  await writeFile(`${path}.lock`, '')
  await assert.rejects(store.save(record), { code: 'PRINT_CREDENTIAL_BUSY' })
  for (const id of ['../escape', '', null, 'C:\\escape'])
    await assert.rejects(store.load(id), { code: 'INVALID_PRINT_CREDENTIAL' })
})

test(
  'Linux rejects public credential directories and files',
  { skip: process.platform === 'win32' },
  async () => {
    const { directory, key, store, record, path } = await setup()
    await store.save(record)
    await chmod(path, 0o644)
    await assert.rejects(store.load(scope.deviceId), {
      code: 'PRINT_CREDENTIAL_UNAVAILABLE',
    })
    await chmod(directory, 0o755)
    await assert.rejects(createCredentialStore(directory, key), {
      code: 'PRINT_CREDENTIAL_UNSAFE_DIRECTORY',
    })
  },
)

test('authenticated journal dispatch stops between copies on revocation and refuses replay', async () => {
  const { root, store, record, credential } = await setup()
  await store.save(record)
  let allowed = true
  const sessions = createPrinterSessions({
    lookupCredential: store.load,
    authorizeDevice: async () => allowed,
  })
  const header = `Basic ${Buffer.from(`${scope.deviceId}:${credential.password}`).toString('base64')}`
  const main = await sessions.openMain(header)
  const raw = await sessions.openRaw(main, header)
  const journal = await createDispatchJournal(join(root, 'journal'))
  const job = {
    ...scope,
    jobId: '40000000-0000-4000-8000-000000000004',
    copies: 2,
    payload: '^XA^FDTest^FS^XZ',
  }
  let sent = 0
  const adapter = {
    authorize: (input) => sessions.authorize(raw, input),
    send: async () => {
      sent++
      allowed = false
    },
  }
  assert.equal((await journal.dispatch(job, adapter)).state, 'outcome_unknown')
  assert.equal(sent, 1)
  allowed = true
  await assert.rejects(journal.dispatch(job, adapter), {
    code: 'PRINT_ALREADY_ATTEMPTED',
  })
  assert.equal(sent, 1)
})

test('token renewal is coalesced, persisted encrypted before use, scoped and renewed after expiry', async () => {
  const { store, record, path } = await setup()
  await store.save(record)
  let clock = 100000
  let requests = 0
  let credentialReads = 0
  const config = {
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    scope,
    store: {
      save: store.save,
      load: async (id) => {
        credentialReads++
        return store.load(id)
      },
    },
    now: () => clock,
    fetchImpl: async (url, options) => {
      assert.equal(
        url.href,
        'https://example.com/auth/v1/token?grant_type=refresh_token',
      )
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      assert.equal(
        JSON.parse(options.body).refresh_token,
        requests ? `refresh-${requests}` : record.refreshToken,
      )
      requests++
      return Response.json({
        access_token: `access-${requests}`,
        refresh_token: `refresh-${requests}`,
        expires_in: 3600,
      })
    },
  }
  const token = createDeviceTokenProvider(config)
  assert.deepEqual(
    await Promise.all(Array.from({ length: 8 }, () => token(scope))),
    Array(8).fill('access-1'),
  )
  assert.equal(requests, 1)
  assert.equal(
    credentialReads,
    2,
    'one read before renewal and one after durable rotation for the entire concurrent group',
  )
  assert.equal((await store.load(scope.deviceId)).refreshToken, 'refresh-1')
  assert.ok(!(await readFile(path, 'utf8')).includes('refresh-1'))
  assert.equal(await token(scope), 'access-1')
  clock += 3600000
  assert.equal(await token(scope), 'access-2')
  const restarted = createDeviceTokenProvider(config)
  assert.equal(await restarted(scope), 'access-3')
  await assert.rejects(token({ ...scope, printerId: scope.deviceId }), {
    message: 'PRINT_DEVICE_UNAUTHORIZED',
  })
  assert.equal(requests, 3)
})

test('refresh rejection, malformed responses and failed persistence never release an access token', async () => {
  const { store, record } = await setup()
  await store.save(record)
  for (const fetchImpl of [
    async () => {
      throw Error('secret refresh token in upstream error')
    },
    async () => new Response('secret provider error', { status: 401 }),
    async () =>
      Response.json({
        access_token: 'secret',
        refresh_token: 'new',
        expires_in: 0,
      }),
  ]) {
    const token = createDeviceTokenProvider({
      url: 'https://example.com',
      publishableKey: 'sb_publishable_fixture',
      scope,
      store,
      fetchImpl,
    })
    await assert.rejects(token(scope), { message: 'PRINT_DEVICE_UNAUTHORIZED' })
  }
  const token = createDeviceTokenProvider({
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    scope,
    store: {
      load: store.load,
      save: async () => {
        throw Error('disk unavailable')
      },
    },
    fetchImpl: async () =>
      Response.json({
        access_token: 'must-not-escape',
        refresh_token: 'new',
        expires_in: 3600,
      }),
  })
  await assert.rejects(token(scope), { message: 'PRINT_DEVICE_UNAUTHORIZED' })
  assert.equal(
    (await store.load(scope.deviceId)).refreshToken,
    record.refreshToken,
  )
})
