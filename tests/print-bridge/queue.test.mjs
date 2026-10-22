import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createWeblinkQueueWorker } from '../../scripts/print-bridge/queue.mjs'
import { createDispatchJournal } from '../../scripts/print-bridge/dispatch.mjs'
import { createWeblinkRpc } from '../../scripts/print-bridge/auth.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const attemptId = '40000000-0000-4000-8000-000000000004'
const jobId = '50000000-0000-4000-8000-000000000005'
const permit = {
  jobId,
  attemptId,
  state: 'dispatching',
  canSend: true,
  copies: 2,
  payload: '^XA^FDRöd^FS^XZ',
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'komisio-web-queue-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-web-queue-'))
    await rm(root, { recursive: true, force: true })
  })
  const journal = await createDispatchJournal(join(root, 'journal'))
  return { root, journal }
}

test('one permit dispatches exact copies and records transport acceptance, never physical output', async (t) => {
  const { journal } = await setup(t)
  const sent = []
  const calls = []
  const worker = createWeblinkQueueWorker({
    scope,
    journal,
    authorize: async () => true,
    send: async (bytes) => sent.push(bytes.toString('utf8')),
    rpc: async (name, args) => {
      calls.push({ name, args })
      return name.startsWith('claim') ? permit : jobId
    },
  })
  assert.deepEqual(await worker.run(attemptId), {
    jobId,
    attemptId,
    state: 'transport_accepted',
  })
  assert.deepEqual(sent, [permit.payload, permit.payload])
  assert.deepEqual(calls[1], {
    name: 'finish_weblink_print_job',
    args: {
      p_tenant: scope.tenantId,
      p_job: jobId,
      p_attempt: attemptId,
      p_outcome: 'transport_accepted',
    },
  })
  // Even an incorrect repeated permit from a caller cannot bypass the journal.
  assert.equal((await worker.run(attemptId)).state, 'outcome_unknown')
  assert.equal(sent.length, 2)
})

test('lost claim response and process restart cannot send a reserved job, even with a fresh journal', async (t) => {
  const { journal, root } = await setup(t)
  let committed = false
  const rpc = async () => {
    if (!committed) {
      committed = true
      throw Error('lost reply with secret')
    }
    return { jobId, attemptId, state: 'dispatching', canSend: false }
  }
  const common = {
    scope,
    rpc,
    authorize: async () => true,
    send: async () => assert.fail('must never send'),
  }
  const first = createWeblinkQueueWorker({ ...common, journal })
  assert.deepEqual(await first.run(attemptId), {
    state: 'claim_unknown',
    attemptId,
  })
  const restarted = createWeblinkQueueWorker({
    ...common,
    journal: await createDispatchJournal(join(root, 'fresh-journal')),
  })
  assert.deepEqual(await restarted.run(attemptId), {
    jobId,
    attemptId,
    state: 'held',
    recordedState: 'dispatching',
  })
})

test('lost completion and partial output remain uncertain, without a resend', async (t) => {
  const { journal } = await setup(t)
  let sent = 0
  let claimed = false
  const worker = createWeblinkQueueWorker({
    scope,
    journal,
    authorize: async () => true,
    send: async () => {
      if (++sent === 2) throw Error('transport secret')
    },
    rpc: async (name, args) => {
      if (name.startsWith('claim')) {
        if (claimed) return { ...permit, canSend: false }
        claimed = true
        return permit
      }
      assert.equal(args.p_outcome, 'outcome_unknown')
      throw Error('lost completion reply')
    },
  })
  assert.equal((await worker.run(attemptId)).state, 'outcome_unknown')
  assert.equal((await worker.run(attemptId)).state, 'held')
  assert.equal(sent, 2)
})

test('failed local authorization or persistence cannot reach the printer', async (t) => {
  const { journal } = await setup(t)
  const denied = createWeblinkQueueWorker({
    scope,
    journal,
    authorize: async () => false,
    rpc: async () => assert.fail('must not claim'),
    send: async () => assert.fail('must not send'),
  })
  await assert.rejects(denied.run(attemptId), {
    message: 'PRINT_DEVICE_UNAUTHORIZED',
  })
  const worker = createWeblinkQueueWorker({
    scope,
    authorize: async () => true,
    journal: {
      dispatch: async () => {
        throw Error('disk failure')
      },
    },
    rpc: async (name, args) => {
      if (name.startsWith('claim')) return permit
      assert.equal(args.p_outcome, 'outcome_unknown')
      return jobId
    },
    send: async () => assert.fail('must not send'),
  })
  assert.equal((await worker.run(attemptId)).state, 'outcome_unknown')
})

test('empty and malformed claims never send; one worker cannot interleave two jobs', async () => {
  const options = {
    scope,
    journal: { dispatch: () => assert.fail('must not dispatch') },
    authorize: async () => true,
    send: () => assert.fail('must not send'),
  }
  for (const claim of [
    null,
    {},
    { ...permit, attemptId: jobId },
    { ...permit, state: 'printed' },
  ]) {
    const worker = createWeblinkQueueWorker({
      ...options,
      rpc: async () => claim,
    })
    assert.equal(
      (await worker.run(attemptId)).state,
      claim === null ? 'empty' : 'claim_unknown',
    )
  }
  let release
  const worker = createWeblinkQueueWorker({
    ...options,
    rpc: () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  const running = worker.run(attemptId)
  await assert.rejects(worker.run(attemptId), { message: 'PRINT_WORKER_BUSY' })
  release(null)
  await running
})

test('queue HTTP adapter pins device scope and RPC names, bounds replies and sanitizes errors', async () => {
  let calls = 0
  const rpc = createWeblinkRpc({
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    scope,
    getAccessToken: async (binding) => {
      assert.deepEqual(binding, scope)
      return 'device-fixture'
    },
    fetchImpl: async (url, options) => {
      calls++
      assert.equal(url.pathname, '/rest/v1/rpc/claim_weblink_print_job')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.Authorization, 'Bearer device-fixture')
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json(permit)
    },
  })
  const args = {
    p_tenant: scope.tenantId,
    p_printer: scope.printerId,
    p_attempt: attemptId,
  }
  assert.deepEqual(await rpc('claim_weblink_print_job', args), permit)
  await assert.rejects(rpc('resolve_weblink_print_job', args), {
    message: 'PRINT_QUEUE_RESULT_UNKNOWN',
  })
  await assert.rejects(
    rpc('claim_weblink_print_job', { ...args, p_tenant: scope.deviceId }),
    { message: 'PRINT_QUEUE_RESULT_UNKNOWN' },
  )
  assert.equal(calls, 1)
  for (const fetchImpl of [
    async () => new Response('secret', { status: 403 }),
    async () => Response.json('x'.repeat(160001)),
  ]) {
    const failing = createWeblinkRpc({
      url: 'https://example.com',
      publishableKey: 'sb_publishable_fixture',
      scope,
      getAccessToken: async () => 'device-fixture',
      fetchImpl,
    })
    await assert.rejects(failing('claim_weblink_print_job', args), {
      message: 'PRINT_QUEUE_RESULT_UNKNOWN',
    })
  }
})
