import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authEndpoint, deviceScope } from './auth.mjs'
import { enrollWeblinkDevice } from './enrollment.mjs'
import { createProvisionedWeblinkService } from './runtime.mjs'
import { pollWeblinkService } from './poller.mjs'

const fail = () => new Error('PRINT_OPERATOR_INPUT_INVALID')
const noFollow = constants.O_NOFOLLOW ?? 0
export async function readPrivateFile(path, maximum) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw fail()
  const file = await open(path, constants.O_RDONLY | noFollow)
  try {
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.size > maximum ||
      (process.platform !== 'win32' &&
        (stat.uid !== process.getuid() || stat.mode & 0o077))
    )
      throw fail()
    return await file.readFile()
  } finally {
    await file.close()
  }
}
async function publishFile(path, content) {
  let file
  try {
    file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    )
  } catch (error) {
    if (
      error.code === 'EEXIST' &&
      (await readPrivateFile(path, 16000)).equals(Buffer.from(content))
    )
      return
    throw fail()
  }
  try {
    await file.writeFile(content)
    await file.sync()
  } finally {
    await file.close()
  }
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), constants.O_RDONLY | noFollow)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
}
export async function loadOperatorConfig(path) {
  const config = JSON.parse(
    (await readPrivateFile(path, 16000)).toString('utf8'),
  )
  authEndpoint(config.url, config.publishableKey)
  deviceScope({ ...config, deviceId: config.printerId })
  if (
    typeof config.host !== 'string' ||
    !/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(config.host) ||
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535 ||
    !Number.isInteger(config.pollMs) ||
    config.pollMs < 1000 ||
    config.pollMs > 60000 ||
    [
      config.enrollmentDirectory,
      config.encryptionKeyFile,
      config.proxySecretFile,
    ].some((path) => typeof path !== 'string' || !isAbsolute(path))
  )
    throw fail()
  const encryptionKey = await readPrivateFile(config.encryptionKeyFile, 32)
  if (encryptionKey.length !== 32) throw fail()
  return { config, encryptionKey }
}
export function printerSetup(host, credentials) {
  if (
    !/^[a-z0-9.-]+$/.test(host) ||
    !/^[A-Za-z0-9_-]{43}$/.test(credentials.password ?? '')
  )
    throw fail()
  const scope = deviceScope(credentials)
  // HTTPS is Zebra's documented location scheme. Do not disable certificate
  // verification. Loading the CA chain and restarting are separate operator steps.
  return (
    `! U1 setvar "weblink.ip.conn1.authentication.add" "${host} ${scope.deviceId} ${credentials.password}"\r\n` +
    `! U1 setvar "weblink.ip.conn1.location" "https://${host}/weblink/${scope.deviceId}"\r\n`
  )
}
async function readPairingCode() {
  let value = ''
  for await (const chunk of process.stdin) {
    value += chunk.toString('utf8')
    if (value.length > 64) throw fail()
  }
  return value.trim() || undefined
}
export async function main(args = process.argv.slice(2)) {
  const [action, path, extra] = args
  if (extra || !['enroll', 'run', 'status'].includes(action)) throw fail()
  const { config, encryptionKey } = await loadOperatorConfig(path)
  if (action === 'enroll') {
    const result = await enrollWeblinkDevice({
      ...config,
      directory: config.enrollmentDirectory,
      encryptionKey,
      pairingCode: await readPairingCode(),
    })
    await publishFile(
      join(config.enrollmentDirectory, 'binding.json'),
      JSON.stringify(deviceScope(result)),
    )
    await publishFile(
      join(config.enrollmentDirectory, 'printer-setup.zpl'),
      printerSetup(config.host, result),
    )
    process.stdout.write('{"state":"paired","next":"configure-printer"}\n')
    return
  }
  if (action === 'status') {
    const response = await fetch(`http://127.0.0.1:${config.port}/healthz`, {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    })
    if (!response.ok) throw fail()
    const status = await response.json()
    if (
      typeof status.connected !== 'boolean' ||
      typeof status.closing !== 'boolean'
    )
      throw fail()
    process.stdout.write(
      JSON.stringify({ connected: status.connected, closing: status.closing }) +
        '\n',
    )
    return
  }
  const scope = deviceScope(
    JSON.parse(
      (
        await readPrivateFile(
          join(config.enrollmentDirectory, 'binding.json'),
          1024,
        )
      ).toString('utf8'),
    ),
  )
  if (
    scope.tenantId !== config.tenantId ||
    scope.printerId !== config.printerId
  )
    throw fail()
  const proxySecret = (await readPrivateFile(config.proxySecretFile, 64))
    .toString('utf8')
    .trim()
  const service = await createProvisionedWeblinkService({
    ...config,
    scope,
    directory: join(config.enrollmentDirectory, 'device'),
    encryptionKey,
    proxyHost: config.host,
    proxySecret,
  })
  const stop = new AbortController()
  const shutdown = () => {
    stop.abort()
    void service.close().catch(() => {})
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  try {
    await pollWeblinkService({
      service,
      signal: stop.signal,
      pollMs: config.pollMs,
      onState: (state) => process.stdout.write(JSON.stringify(state) + '\n'),
    })
  } finally {
    process.off('SIGTERM', shutdown)
    process.off('SIGINT', shutdown)
    encryptionKey.fill(0)
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const code = /^PRINT_[A-Z_]+$/.test(error.message ?? '')
      ? error.message
      : 'PRINT_SERVICE_UNAVAILABLE'
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  })
}
