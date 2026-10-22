import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RECORD_BYTES = 4096
const noFollow = constants.O_NOFOLLOW ?? 0

function refusal(code) {
  return Object.assign(new Error(code), { code })
}

function identity(value) {
  if (!value || typeof value !== 'object') throw refusal('INVALID_PRINT_JOB')
  const result = {}
  for (const key of ['tenantId', 'printerId', 'jobId']) {
    if (typeof value[key] !== 'string' || !UUID.test(value[key]))
      throw refusal('INVALID_PRINT_JOB')
    result[key] = value[key].toLowerCase()
  }
  return result
}

function prepare(input) {
  const ids = identity(input)
  if (
    typeof input.deviceId !== 'string' ||
    !UUID.test(input.deviceId) ||
    typeof input.payload !== 'string' ||
    !input.payload.startsWith('^XA') ||
    !input.payload.endsWith('^XZ') ||
    Buffer.byteLength(input.payload, 'utf8') > 80000 ||
    !Number.isInteger(input.copies) ||
    input.copies < 1 ||
    input.copies > 20
  )
    throw refusal('INVALID_PRINT_JOB')
  // Snapshot before awaiting caller callbacks; never persist label text or tokens.
  const job = Object.freeze({
    ...ids,
    deviceId: input.deviceId.toLowerCase(),
    payload: input.payload,
    copies: input.copies,
  })
  const digest = createHash('sha256')
    .update(JSON.stringify([ids, job.payload, job.copies]))
    .digest('hex')
  return { job, digest }
}

async function syncDirectory(directory) {
  // Windows supports the development tests, not the Linux service durability
  // guarantee. The production journal must live on a local persistent Linux FS.
  if (process.platform === 'win32') return
  const handle = await open(directory, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function append(handle, value) {
  await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
  await handle.sync()
}

/**
 * Inactive building block for the future Weblink service. It opens no network
 * listener, claims no queue jobs and grants no device permissions. All workers
 * must share this directory. Deleting/restoring it can permit duplicate output;
 * queue fencing and reviewed recovery remain required before hosted activation.
 */
export async function createDispatchJournal(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    throw refusal('PRINT_JOURNAL_UNSAFE_DIRECTORY')
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw refusal('PRINT_JOURNAL_UNAVAILABLE')
  }
  const root = await lstat(directory)
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      ((root.mode & 0o077) !== 0 || root.uid !== process.getuid()))
  )
    throw refusal('PRINT_JOURNAL_UNSAFE_DIRECTORY')
  await syncDirectory(directory)
  await syncDirectory(dirname(directory))

  async function inspect(input) {
    const ids = identity(input)
    let handle
    try {
      handle = await open(
        join(directory, `${ids.jobId}.jsonl`),
        constants.O_RDONLY | noFollow,
      )
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
        throw refusal('PRINT_JOURNAL_CORRUPT')
      const text = await handle.readFile('utf8')
      // Even an empty or truncated file is a persistent reservation, never an
      // unused job. Do not "repair" it by deleting or replacing the record.
      if (!text.endsWith('\n')) throw refusal('PRINT_JOURNAL_CORRUPT')
      let records
      try {
        records = text
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
      } catch {
        throw refusal('PRINT_JOURNAL_CORRUPT')
      }
      const [intent, result] = records
      if (
        records.length < 1 ||
        records.length > 2 ||
        intent?.version !== 1 ||
        intent.state !== 'attempting' ||
        typeof intent.digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(intent.digest) ||
        typeof intent.deviceId !== 'string' ||
        !UUID.test(intent.deviceId) ||
        !Number.isInteger(intent.copies) ||
        intent.copies < 1 ||
        intent.copies > 20 ||
        (result &&
          !['transport_accepted', 'outcome_unknown'].includes(result.state))
      )
        throw refusal('PRINT_JOURNAL_CORRUPT')
      if (Object.entries(ids).some(([key, value]) => intent[key] !== value))
        throw refusal('PRINT_JOB_CONFLICT')
      return Object.freeze({
        ...ids,
        deviceId: intent.deviceId,
        copies: intent.copies,
        digest: intent.digest,
        state: result?.state ?? 'outcome_unknown',
      })
    } catch (error) {
      if (error.code === 'ENOENT') return null
      if (['PRINT_JOURNAL_CORRUPT', 'PRINT_JOB_CONFLICT'].includes(error.code))
        throw error
      throw refusal('PRINT_JOURNAL_UNAVAILABLE')
    } finally {
      await handle?.close()
    }
  }

  /**
   * authorize must revalidate the device session/binding; true means currently
   * authorized. send is a bounded transport write, NOT proof of physical output.
   * Each copy uses the original ZPL exactly, matching the existing agent.
   */
  async function dispatch(input, { authorize, send }) {
    const { job, digest } = prepare(input)
    if (typeof authorize !== 'function' || typeof send !== 'function')
      throw refusal('INVALID_PRINT_ADAPTER')
    const scope = Object.freeze({
      tenantId: job.tenantId,
      printerId: job.printerId,
      deviceId: job.deviceId,
    })
    try {
      if ((await authorize(scope)) !== true)
        throw refusal('PRINT_DEVICE_UNAUTHORIZED')
    } catch {
      throw refusal('PRINT_DEVICE_UNAUTHORIZED')
    }
    let handle
    try {
      handle = await open(
        join(directory, `${job.jobId}.jsonl`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
    } catch (error) {
      if (error.code === 'EEXIST') {
        const existing = await inspect(job)
        if (!existing) throw refusal('PRINT_JOURNAL_UNAVAILABLE')
        if (existing.digest !== digest) throw refusal('PRINT_JOB_CONFLICT')
        throw refusal('PRINT_ALREADY_ATTEMPTED')
      }
      throw refusal('PRINT_JOURNAL_UNAVAILABLE')
    }
    try {
      try {
        await append(handle, {
          version: 1,
          ...identity(job),
          deviceId: job.deviceId,
          copies: job.copies,
          digest,
          state: 'attempting',
        })
        await syncDirectory(directory)
      } catch {
        throw refusal('PRINT_JOURNAL_UNAVAILABLE')
      }
      let state = 'transport_accepted'
      try {
        for (let copy = 0; copy < job.copies; copy++) {
          if ((await authorize(scope)) !== true)
            throw refusal('PRINT_DEVICE_UNAUTHORIZED')
          await send(Buffer.from(job.payload, 'utf8'))
        }
      } catch {
        // A timeout, revoked session or socket error may follow actual output.
        // Preserve only a fixed state; provider errors may contain credentials.
        state = 'outcome_unknown'
      }
      try {
        await append(handle, { state })
      } catch {
        // The durable intent still prevents replay even if this append fails.
        state = 'outcome_unknown'
      }
      return Object.freeze({ jobId: job.jobId, state })
    } finally {
      await handle.close()
    }
  }

  return Object.freeze({ dispatch, inspect })
}
