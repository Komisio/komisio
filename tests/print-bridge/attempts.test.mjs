import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  unlink,
  chmod,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { createAttemptStore } from '../../scripts/print-bridge/attempts.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const jobId = '50000000-0000-4000-8000-000000000005'
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'komisio-attempts-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-attempts-'))
    await rm(root, { recursive: true, force: true })
  })
  return { root, directory: join(root, 'attempts') }
}

test('intent precedes the claim; an uncertain result halts even after reopening', async (t) => {
  const { directory } = await setup(t)
  const store = await createAttemptStore(directory, scope)
  let id, disk
  const first = await store.run(async (attemptId) => {
    id = attemptId
    disk = JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'))
    return { attemptId, state: 'claim_unknown', secret: 'must-not-persist' }
  })
  assert.deepEqual(first, { attemptId: id, state: 'claim_unknown' })
  assert.equal(disk.attemptId, id)
  assert.equal(disk.state, 'pending')
  assert.equal(disk.deviceId, scope.deviceId)
  assert.ok(
    !(await readFile(join(directory, 'current.json'), 'utf8')).includes(
      'must-not-persist',
    ),
  )
  await store.close()
  const restarted = await createAttemptStore(directory, scope)
  assert.deepEqual(
    await restarted.run(() => assert.fail('no automatic retry')),
    { attemptId: id, state: 'held' },
  )
  await restarted.close()
})

test('empty and transport acceptance permit a new attempt; overlapping calls and owners are refused', async (t) => {
  const { directory } = await setup(t)
  const store = await createAttemptStore(directory, scope)
  await assert.rejects(
    createAttemptStore(directory, scope),
    /PRINT_ATTEMPT_STORE_LOCKED/,
  )
  const ids = []
  for (const state of ['empty', 'transport_accepted', 'outcome_unknown']) {
    const result = await store.run(async (attemptId) => {
      ids.push(attemptId)
      await assert.rejects(
        store.run(() => assert.fail()),
        /PRINT_WORKER_BUSY/,
      )
      await assert.rejects(store.close(), /PRINT_WORKER_BUSY/)
      return { state, attemptId, ...(state === 'empty' ? {} : { jobId }) }
    })
    assert.equal(result.state, state)
  }
  assert.equal(new Set(ids).size, 3)
  assert.deepEqual(await store.run(() => assert.fail()), {
    state: 'held',
    attemptId: ids[2],
    jobId,
  })
  await store.close()
})

test('worker exceptions and malformed successful results persist a sanitized uncertainty', async (t) => {
  const { root } = await setup(t)
  const workers = [
    () => {
      throw Error('private session token')
    },
    (attemptId) => ({ attemptId, state: 'transport_accepted' }),
    () => ({ attemptId: jobId, state: 'empty' }),
  ]
  for (const [index, worker] of workers.entries()) {
    const store = await createAttemptStore(join(root, `${index}`), scope)
    assert.equal((await store.run(worker)).state, 'claim_unknown')
    assert.equal((await store.run(() => assert.fail())).state, 'held')
    await store.close()
  }
})

test('a killed process leaves ownership and intent; reviewed lock removal cannot replay', async (t) => {
  const { directory } = await setup(t)
  const moduleUrl = new URL(
    '../../scripts/print-bridge/attempts.mjs',
    import.meta.url,
  ).href
  const code = `import { createAttemptStore } from ${JSON.stringify(moduleUrl)};
    const store = await createAttemptStore(process.argv[1], JSON.parse(process.argv[2]));
    await store.run(() => process.exit(17));`
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', code, directory, JSON.stringify(scope)],
    { stdio: 'ignore' },
  )
  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', resolve)
  })
  assert.equal(exit, 17)
  await assert.rejects(
    createAttemptStore(directory, scope),
    /PRINT_ATTEMPT_STORE_LOCKED/,
  )
  const saved = JSON.parse(
    await readFile(join(directory, 'current.json'), 'utf8'),
  )
  assert.equal(saved.state, 'pending')
  // Simulate explicit operator review after the child is conclusively stopped.
  await unlink(join(directory, 'owner.lock'))
  const reopened = await createAttemptStore(directory, scope)
  assert.deepEqual(await reopened.run(() => assert.fail()), {
    state: 'held',
    attemptId: saved.attemptId,
  })
  await reopened.close()
})

test('truncated or differently scoped evidence is never treated as an empty store', async (t) => {
  const { root } = await setup(t)
  for (const [index, corrupt] of [true, false].entries()) {
    const directory = join(root, `${index}`)
    const store = await createAttemptStore(directory, scope)
    await store.run((attemptId) => ({ attemptId, state: 'empty' }))
    await store.close()
    if (corrupt) await writeFile(join(directory, 'current.json'), '{')
    await assert.rejects(
      createAttemptStore(
        directory,
        corrupt ? scope : { ...scope, printerId: jobId },
      ),
      /PRINT_ATTEMPT_STORAGE_UNAVAILABLE/,
    )
    await assert.rejects(
      createAttemptStore(directory, scope),
      /PRINT_ATTEMPT_STORE_LOCKED/,
    )
  }
})

test(
  'Linux refuses public directories and symlinked state; failed completion keeps a recovery lock',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { root, directory } = await setup(t)
    const store = await createAttemptStore(directory, scope)
    await assert.rejects(
      store.run(async (attemptId) => {
        await chmod(directory, 0o500)
        return { state: 'empty', attemptId }
      }),
      /PRINT_ATTEMPT_STORAGE_UNAVAILABLE/,
    )
    await chmod(directory, 0o700)
    await store.close()
    assert.equal(
      JSON.parse(await readFile(join(directory, 'current.json'), 'utf8')).state,
      'pending',
    )
    await assert.rejects(
      createAttemptStore(directory, scope),
      /PRINT_ATTEMPT_STORE_LOCKED/,
    )
    await unlink(join(directory, 'owner.lock'))
    await chmod(directory, 0o755)
    await assert.rejects(
      createAttemptStore(directory, scope),
      /PRINT_ATTEMPT_STORAGE_UNAVAILABLE/,
    )
    await chmod(directory, 0o700)
    await unlink(join(directory, 'current.json'))
    await writeFile(join(root, 'target.json'), '{}', { mode: 0o600 })
    await symlink(join(root, 'target.json'), join(directory, 'current.json'))
    await assert.rejects(
      createAttemptStore(directory, scope),
      /PRINT_ATTEMPT_STORAGE_UNAVAILABLE/,
    )
  },
)
