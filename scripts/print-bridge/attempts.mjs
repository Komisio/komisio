import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { deviceScope } from './auth.mjs'

const noFollow = constants.O_NOFOLLOW ?? 0
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const outcomes = [
  'empty',
  'transport_accepted',
  'claim_unknown',
  'held',
  'outcome_unknown',
]
const fail = () => new Error('PRINT_ATTEMPT_STORAGE_UNAVAILABLE')

async function syncDirectory(path) {
  if (process.platform === 'win32') return
  const fd = await open(path, constants.O_RDONLY | noFollow)
  try {
    await fd.sync()
  } finally {
    await fd.close()
  }
}

function privateFile(stat) {
  return (
    stat.isFile() &&
    (process.platform === 'win32' ||
      (stat.uid === process.getuid() && (stat.mode & 0o077) === 0))
  )
}

/**
 * Single-process ownership on a private, local Linux filesystem. A crash leaves
 * owner.lock: an operator must stop the old process and review it, never steal it
 * by timeout/PID. Preserve current.json and the dispatch journal during recovery.
 * Uncertain attempts halt intake, including after a clean restart. No retry loop.
 */
export async function createAttemptStore(directory, input) {
  const scope = deviceScope(input)
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw fail()
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw fail()
  }
  const stat = await lstat(directory)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
  )
    throw fail()
  await syncDirectory(directory)
  await syncDirectory(dirname(directory))
  const lockPath = join(directory, 'owner.lock')
  let lock
  try {
    lock = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    )
    await lock.writeFile(JSON.stringify(scope))
    await lock.sync()
    await syncDirectory(directory)
  } catch {
    await lock?.close()
    throw new Error('PRINT_ATTEMPT_STORE_LOCKED')
  }
  const path = join(directory, 'current.json')
  let current = null
  let busy = false
  let closed = false
  let poisoned = false
  try {
    let fd
    try {
      fd = await open(path, constants.O_RDONLY | noFollow)
      const stat = await fd.stat()
      if (!privateFile(stat) || stat.size > 2048) throw fail()
      current = JSON.parse(await fd.readFile('utf8'))
      if (
        current?.version !== 1 ||
        !uuid.test(current.attemptId ?? '') ||
        !['pending', ...outcomes].includes(current.state) ||
        Object.keys(scope).some((key) => current[key] !== scope[key]) ||
        (current.jobId !== undefined && !uuid.test(current.jobId)) ||
        (current.state === 'transport_accepted' &&
          !uuid.test(current.jobId ?? ''))
      )
        throw fail()
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail()
    } finally {
      await fd?.close()
    }
  } catch {
    // Leave the lock as evidence; corrupt/truncated state is never an empty queue.
    await lock.close()
    throw fail()
  }

  async function save(record) {
    const temporary = join(directory, `${randomUUID()}.tmp`)
    let fd
    try {
      fd = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
      await fd.writeFile(JSON.stringify(record))
      await fd.sync()
      await fd.close()
      fd = null
      await rename(temporary, path)
      await syncDirectory(directory)
      current = record
    } catch {
      poisoned = true
      throw fail()
    } finally {
      await fd?.close()
      await unlink(temporary).catch(() => {})
    }
  }

  async function run(worker) {
    if (closed || poisoned) throw fail()
    if (busy) throw new Error('PRINT_WORKER_BUSY')
    if (current && !['empty', 'transport_accepted'].includes(current.state))
      return Object.freeze({
        state: 'held',
        attemptId: current.attemptId,
        ...(current.jobId ? { jobId: current.jobId } : {}),
      })
    busy = true
    try {
      const attemptId = randomUUID()
      await save({ version: 1, ...scope, attemptId, state: 'pending' })
      let result
      try {
        result = await worker(attemptId)
      } catch {
        result = null
      }
      if (
        !result ||
        result.attemptId !== attemptId ||
        !outcomes.includes(result.state) ||
        (result.jobId !== undefined && !uuid.test(result.jobId)) ||
        (result.state === 'transport_accepted' &&
          !uuid.test(result.jobId ?? ''))
      )
        result = { state: 'claim_unknown', attemptId }
      // Persist only fixed evidence, never errors, tokens or label text.
      const evidence = {
        state: result.state,
        attemptId,
        ...(result.jobId ? { jobId: result.jobId } : {}),
      }
      await save({ version: 1, ...scope, ...evidence })
      return Object.freeze(evidence)
    } finally {
      busy = false
    }
  }

  async function close() {
    if (busy) throw new Error('PRINT_WORKER_BUSY')
    if (closed) return
    closed = true
    await lock.close()
    // A storage failure requires operator review rather than automatic reopening.
    if (!poisoned) {
      await unlink(lockPath)
      await syncDirectory(directory)
    }
  }
  return Object.freeze({ run, close })
}
