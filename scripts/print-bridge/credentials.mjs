import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { deviceScope } from './auth.mjs'

const noFollow = constants.O_NOFOLLOW ?? 0
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const failure = (code) => Object.assign(new Error(code), { code })

function privateFile(stat) {
  return (
    process.platform === 'win32' ||
    ((stat.mode & 0o077) === 0 && stat.uid === process.getuid())
  )
}

async function syncDirectory(path) {
  if (process.platform === 'win32') return
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function payload(value) {
  const scope = deviceScope(value)
  if (
    typeof value.secretDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.secretDigest ?? '') ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length < 1 ||
    value.refreshToken.length > 8192 ||
    /[\r\n]/.test(value.refreshToken)
  )
    throw failure('INVALID_PRINT_CREDENTIAL')
  const record = {
    ...scope,
    secretDigest: value.secretDigest,
    refreshToken: value.refreshToken,
  }
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > 12000)
    throw failure('INVALID_PRINT_CREDENTIAL')
  return Object.freeze(record)
}

/**
 * Linux-only production storage contract; no key is generated or stored here.
 * Supply a 32-byte service key separately from this directory and its backups.
 * A crashed writer leaves a lock: stop writers and review before removing it.
 */
export async function createCredentialStore(directory, encryptionKey) {
  if (
    typeof directory !== 'string' ||
    !isAbsolute(directory) ||
    !Buffer.isBuffer(encryptionKey) ||
    encryptionKey.length !== 32
  )
    throw failure('INVALID_PRINT_CREDENTIAL_CONFIG')
  const key = Buffer.from(encryptionKey)
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
  }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateFile(stat))
    throw failure('PRINT_CREDENTIAL_UNSAFE_DIRECTORY')
  await syncDirectory(directory)
  await syncDirectory(dirname(directory))

  function pathFor(deviceId) {
    if (typeof deviceId !== 'string' || !UUID.test(deviceId))
      throw failure('INVALID_PRINT_CREDENTIAL')
    return join(directory, `${deviceId}.sealed`)
  }

  async function load(deviceId) {
    const path = pathFor(deviceId)
    let file
    try {
      file = await open(path, constants.O_RDONLY | noFollow)
      const stat = await file.stat()
      if (!stat.isFile() || !privateFile(stat) || stat.size > 20000)
        throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
      const envelope = JSON.parse(await file.readFile('utf8'))
      if (
        envelope.version !== 1 ||
        !UUID.test(envelope.revision ?? '') ||
        !/^[a-f0-9]{24}$/.test(envelope.iv ?? '') ||
        !/^[a-f0-9]{32}$/.test(envelope.tag ?? '') ||
        typeof envelope.ciphertext !== 'string'
      )
        throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
      const cipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.iv, 'hex'),
      )
      cipher.setAAD(
        Buffer.from(`komisio-print:1:${deviceId}:${envelope.revision}`),
      )
      cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'))
      const clear = Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        cipher.final(),
      ])
      const value = payload(JSON.parse(clear.toString('utf8')))
      if (value.deviceId !== deviceId)
        throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
      return Object.freeze({ ...value, revision: envelope.revision })
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
    } finally {
      await file?.close()
    }
  }

  // Compare-and-swap prevents stale refresh/rotation writers overwriting a newer
  // credential. A busy writer fails closed; callers must reread before retrying.
  async function save(input, expectedRevision = null) {
    const value = payload(input)
    const path = pathFor(value.deviceId)
    if (expectedRevision !== null && !UUID.test(expectedRevision))
      throw failure('INVALID_PRINT_CREDENTIAL')
    const lockPath = `${path}.lock`
    let lock
    try {
      lock = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
    } catch {
      throw failure('PRINT_CREDENTIAL_BUSY')
    }
    let temporary
    try {
      const previous = await load(value.deviceId)
      if ((previous?.revision ?? null) !== expectedRevision)
        throw failure('PRINT_CREDENTIAL_CONFLICT')
      // Rebinding an existing identity requires revocation and a new pairing.
      if (
        previous &&
        (previous.tenantId !== value.tenantId ||
          previous.printerId !== value.printerId)
      )
        throw failure('PRINT_CREDENTIAL_CONFLICT')
      const revision = randomUUID()
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(
        Buffer.from(`komisio-print:1:${value.deviceId}:${revision}`),
      )
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ])
      temporary = `${path}.${revision}.tmp`
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
      try {
        await file.writeFile(
          JSON.stringify({
            version: 1,
            revision,
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex'),
            ciphertext: ciphertext.toString('base64'),
          }) + '\n',
        )
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, path)
      temporary = undefined
      await syncDirectory(directory)
      return revision
    } catch (error) {
      if (error.code === 'PRINT_CREDENTIAL_CONFLICT') throw error
      throw failure('PRINT_CREDENTIAL_UNAVAILABLE')
    } finally {
      if (temporary) await unlink(temporary).catch(() => {})
      await lock.close()
      await unlink(lockPath)
    }
  }

  return Object.freeze({ load, save })
}
