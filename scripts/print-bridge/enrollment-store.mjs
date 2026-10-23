import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'

const noFollow = constants.O_NOFOLLOW ?? 0
const fail = () => new Error('PRINT_ENROLLMENT_STORAGE_UNAVAILABLE')
async function syncDirectory(path) {
  if (process.platform === 'win32') return
  const fd = await open(path, constants.O_RDONLY | noFollow)
  try {
    await fd.sync()
  } finally {
    await fd.close()
  }
}
function privateOwner(stat) {
  return (
    process.platform === 'win32' ||
    (stat.uid === process.getuid() && !(stat.mode & 0o077))
  )
}

/** Exclusive, encrypted checkpoint for the entire enrollment operation. */
export async function createEnrollmentStore(directory, encryptionKey) {
  if (
    !isAbsolute(directory ?? '') ||
    !Buffer.isBuffer(encryptionKey) ||
    encryptionKey.length !== 32
  )
    throw fail()
  const key = Buffer.from(encryptionKey)
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw fail()
  }
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat))
    throw fail()
  await syncDirectory(directory)
  await syncDirectory(dirname(directory))
  const lockPath = join(directory, 'enrollment.lock')
  let lock
  try {
    lock = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    )
    await lock.sync()
    await syncDirectory(directory)
  } catch {
    await lock?.close()
    throw new Error('PRINT_ENROLLMENT_LOCKED')
  }
  let closed = false,
    poisoned = false
  const path = join(directory, 'enrollment.sealed')
  async function load() {
    if (closed || poisoned) throw fail()
    let fd
    try {
      fd = await open(path, constants.O_RDONLY | noFollow)
      const stat = await fd.stat()
      if (!stat.isFile() || !privateOwner(stat) || stat.size > 40000)
        throw fail()
      const envelope = JSON.parse(await fd.readFile('utf8'))
      if (
        envelope.version !== 1 ||
        !/^[a-f0-9]{24}$/.test(envelope.iv ?? '') ||
        !/^[a-f0-9]{32}$/.test(envelope.tag ?? '') ||
        typeof envelope.ciphertext !== 'string'
      )
        throw fail()
      const cipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(envelope.iv, 'hex'),
      )
      cipher.setAAD(Buffer.from('komisio-enrollment:1'))
      cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'))
      return JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
          cipher.final(),
        ]).toString('utf8'),
      )
    } catch (error) {
      if (error.code === 'ENOENT') return null
      poisoned = true
      throw fail()
    } finally {
      await fd?.close()
    }
  }
  async function save(value) {
    if (closed || poisoned) throw fail()
    const clear = JSON.stringify(value)
    if (!clear || Buffer.byteLength(clear) > 24000) throw fail()
    const temporary = join(directory, `${randomUUID()}.tmp`)
    let fd
    try {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from('komisio-enrollment:1'))
      const ciphertext = Buffer.concat([
        cipher.update(clear, 'utf8'),
        cipher.final(),
      ])
      fd = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
      await fd.writeFile(
        JSON.stringify({
          version: 1,
          iv: iv.toString('hex'),
          tag: cipher.getAuthTag().toString('hex'),
          ciphertext: ciphertext.toString('base64'),
        }),
      )
      await fd.sync()
      await fd.close()
      fd = null
      await rename(temporary, path)
      await syncDirectory(directory)
    } catch {
      poisoned = true
      throw fail()
    } finally {
      await fd?.close()
      await unlink(temporary).catch(() => {})
    }
  }
  async function close() {
    if (closed) return
    closed = true
    await lock.close()
    if (!poisoned) {
      await unlink(lockPath)
      await syncDirectory(directory)
    }
  }
  return Object.freeze({ load, save, close })
}
