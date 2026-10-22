import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readPrivateFile } from './cli.mjs'
import { createManagedWeblink } from './managed.mjs'

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1) throw new Error('PRINT_MANAGED_CONFIG')
  const config = JSON.parse(
    (await readPrivateFile(args[0], 16000)).toString('utf8'),
  )
  if (
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error('PRINT_MANAGED_CONFIG')
  const encryptionKey = await readPrivateFile(config.encryptionKeyFile, 32)
  const proxySecret = (await readPrivateFile(config.proxySecretFile, 64))
    .toString('utf8')
    .trim()
  const managementSecret = (
    await readPrivateFile(config.managementSecretFile, 64)
  )
    .toString('utf8')
    .trim()
  const caBundle = (await readPrivateFile(config.caBundleFile, 12000)).toString(
    'utf8',
  )
  const service = await createManagedWeblink({
    ...config,
    encryptionKey,
    proxySecret,
    managementSecret,
    caBundle,
  })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await service.close()
    encryptionKey.fill(0)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.stdout.write('{"state":"ready"}\n')
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write('PRINT_MANAGED_UNAVAILABLE\n')
    process.exitCode = 1
  })
}
