import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  symlink,
  rename,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'

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
    assert.ok(basename(root).startsWith('komisio-dispatch-'))
    await rm(root, { recursive: true, force: true })
  }
})

const job = Object.freeze({
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
  jobId: '40000000-0000-4000-8000-000000000004',
  payload: '^XA^CI28^FDRöd testetikett^FS^XZ',
  copies: 1,
})
const allow = async () => true
const denySend = async () => assert.fail('must not reach transport')
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'komisio-dispatch-'))
  roots.push(root)
  const directory = join(root, 'journal')
  const journal = await createDispatchJournal(directory)
  return {
    root,
    directory,
    journal,
    record: join(directory, `${job.jobId}.jsonl`),
  }
}
function worker(config) {
  const child = fork(
    fileURLToPath(
      new URL('../fixtures/print-dispatch-worker.mjs', import.meta.url),
    ),
    [],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  )
  children.add(child)
  const response = once(child, 'message').then(([message]) => message)
  child.send({ ...config, job })
  return { child, response }
}

test('persists intent before exact UTF-8 copies; acceptance never means printed', async () => {
  const { journal, record } = await setup()
  const sent = []
  const input = { ...job, copies: 2 }
  const result = await journal.dispatch(input, {
    authorize: async (scope) => {
      assert.equal(scope.tenantId, job.tenantId)
      assert.equal(scope.printerId, job.printerId)
      assert.equal(scope.deviceId, job.deviceId)
      return true
    },
    send: async (bytes) => {
      const intent = JSON.parse((await readFile(record, 'utf8')).trim())
      assert.equal(intent.state, 'attempting')
      assert.equal(intent.copies, 2)
      sent.push(bytes.toString('utf8'))
      input.payload = '^XA^FDchanged^FS^XZ'
      input.copies = 20
    },
  })
  assert.deepEqual(sent, [job.payload, job.payload])
  assert.equal(result.state, 'transport_accepted')
  const stored = await readFile(record, 'utf8')
  assert.ok(!stored.includes('Röd'))
  assert.ok(!stored.includes('printed'))
  assert.equal((await journal.inspect(job)).state, 'transport_accepted')
})

test('a new instance refuses completed jobs and detects changed payload/copies/binding', async () => {
  const { directory, journal } = await setup()
  await journal.dispatch(job, { authorize: allow, send: async () => {} })
  const restarted = await createDispatchJournal(directory)
  await assert.rejects(
    restarted.dispatch(job, { authorize: allow, send: denySend }),
    { code: 'PRINT_ALREADY_ATTEMPTED' },
  )
  for (const changed of [
    { payload: '^XA^FDdifferent^FS^XZ' },
    { copies: 2 },
    { tenantId: '90000000-0000-4000-8000-000000000009' },
    { printerId: '90000000-0000-4000-8000-000000000009' },
  ])
    await assert.rejects(
      restarted.dispatch(
        { ...job, ...changed },
        { authorize: allow, send: denySend },
      ),
      { code: 'PRINT_JOB_CONFLICT' },
    )
  // A newly paired worker must not treat the same queued job as new work.
  await assert.rejects(
    restarted.dispatch(
      { ...job, deviceId: '90000000-0000-4000-8000-000000000009' },
      { authorize: allow, send: denySend },
    ),
    { code: 'PRINT_ALREADY_ATTEMPTED' },
  )
})

test('partial copy failure is held without persisting peer error text or resending', async () => {
  const { journal, directory, record } = await setup()
  let sends = 0
  const input = { ...job, copies: 3 }
  const result = await journal.dispatch(input, {
    authorize: allow,
    send: async () => {
      sends++
      if (sends === 2) throw new Error('secret-reconnect-token')
    },
  })
  assert.equal(sends, 2)
  assert.equal(result.state, 'outcome_unknown')
  assert.ok(
    !(await readFile(record, 'utf8')).includes('secret-reconnect-token'),
  )
  const restarted = await createDispatchJournal(directory)
  assert.equal((await restarted.inspect(job)).state, 'outcome_unknown')
  await assert.rejects(
    restarted.dispatch(input, { authorize: allow, send: denySend }),
    { code: 'PRINT_ALREADY_ATTEMPTED' },
  )
})

test('denied authorization creates no reservation; revocation between copies stops output', async () => {
  const { journal } = await setup()
  await assert.rejects(
    journal.dispatch(job, { authorize: async () => false, send: denySend }),
    { code: 'PRINT_DEVICE_UNAUTHORIZED' },
  )
  assert.equal(await journal.inspect(job), null)
  let checks = 0
  let sends = 0
  const result = await journal.dispatch(
    { ...job, copies: 2 },
    {
      authorize: async () => ++checks <= 2,
      send: async () => {
        sends++
      },
    },
  )
  assert.equal(sends, 1)
  assert.equal(result.state, 'outcome_unknown')
})

test('empty, torn, oversized and foreign journal records fail closed', async () => {
  const { journal, record } = await setup()
  for (const contents of ['', '{', '{"version":1}\n', 'x'.repeat(5000)]) {
    await writeFile(record, contents)
    await assert.rejects(
      journal.dispatch(job, { authorize: allow, send: denySend }),
      { code: 'PRINT_JOURNAL_CORRUPT' },
    )
    assert.equal(await readFile(record, 'utf8'), contents)
  }
})

test('invalid jobs never reserve files or reach authorization/transport', async () => {
  const { journal } = await setup()
  for (const changed of [
    { jobId: '../escape' },
    { deviceId: '' },
    { tenantId: null },
    { payload: 'not ZPL' },
    { payload: `^XA${'a'.repeat(80000)}^XZ` },
    { copies: 0 },
    { copies: 21 },
    { copies: 1.5 },
  ])
    await assert.rejects(
      journal.dispatch(
        { ...job, ...changed },
        { authorize: denySend, send: denySend },
      ),
      { code: 'INVALID_PRINT_JOB' },
    )
  assert.equal(await journal.inspect(job), null)
})

test('unavailable journal prevents output even after authorization succeeds', async () => {
  const { journal, directory } = await setup()
  await rename(directory, `${directory}-saved`)
  await writeFile(directory, 'not a directory')
  await assert.rejects(
    journal.dispatch(job, { authorize: allow, send: denySend }),
    { code: 'PRINT_JOURNAL_UNAVAILABLE' },
  )
})

test('authorization outage is sanitized; revocation before first write leaves a hold', async () => {
  const { journal } = await setup()
  await assert.rejects(
    journal.dispatch(job, {
      authorize: async () => {
        throw new Error('secret-device-session')
      },
      send: denySend,
    }),
    { message: 'PRINT_DEVICE_UNAUTHORIZED', code: 'PRINT_DEVICE_UNAUTHORIZED' },
  )
  assert.equal(await journal.inspect(job), null)
  let calls = 0
  const result = await journal.dispatch(job, {
    authorize: async () => ++calls === 1,
    send: denySend,
  })
  assert.equal(result.state, 'outcome_unknown')
  await assert.rejects(
    journal.dispatch(job, { authorize: allow, send: denySend }),
    { code: 'PRINT_ALREADY_ATTEMPTED' },
  )
})

test(
  'separate processes sharing a journal allow one transport attempt',
  { timeout: 15000 },
  async () => {
    const { directory, root } = await setup()
    const output = join(root, 'synthetic-output')
    const workers = Array.from({ length: 6 }, () =>
      worker({ directory, output }),
    )
    const results = await Promise.all(workers.map(({ response }) => response))
    assert.equal(
      results.filter((r) => r.state === 'transport_accepted').length,
      1,
    )
    assert.ok(
      results
        .filter((r) => r.error)
        .every((r) =>
          ['PRINT_ALREADY_ATTEMPTED', 'PRINT_JOURNAL_CORRUPT'].includes(
            r.error,
          ),
        ),
    )
    assert.equal(await readFile(output, 'utf8'), 'sent\n')
  },
)

test(
  'process death after output but before completion cannot repeat the job',
  { timeout: 15000 },
  async () => {
    const { directory, root } = await setup()
    const output = join(root, 'synthetic-output')
    const first = worker({ directory, output, crash: true })
    assert.deepEqual(await first.response, { sent: true })
    const exited = once(first.child, 'exit')
    first.child.kill('SIGKILL')
    await exited
    const restarted = await createDispatchJournal(directory)
    assert.equal((await restarted.inspect(job)).state, 'outcome_unknown')
    const second = worker({ directory, output })
    assert.deepEqual(await second.response, {
      error: 'PRINT_ALREADY_ATTEMPTED',
    })
    assert.equal(await readFile(output, 'utf8'), 'sent\n')
  },
)

test(
  'Linux service rejects shared or symlinked state directories',
  { skip: process.platform === 'win32' },
  async () => {
    const { directory, root } = await setup()
    await chmod(directory, 0o755)
    await assert.rejects(createDispatchJournal(directory), {
      code: 'PRINT_JOURNAL_UNSAFE_DIRECTORY',
    })
    await chmod(directory, 0o700)
    const alias = join(root, 'alias')
    await symlink(directory, alias)
    await assert.rejects(createDispatchJournal(alias), {
      code: 'PRINT_JOURNAL_UNSAFE_DIRECTORY',
    })
  },
)
