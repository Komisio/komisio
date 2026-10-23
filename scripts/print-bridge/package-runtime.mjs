import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// Prepare a minimal release tree with the repository's exact locked ws artifact.
// Never overwrite an existing destination or include credentials/private files.
export async function packageRuntime(destination) {
  if (!isAbsolute(destination ?? ''))
    throw new Error('PRINT_PACKAGE_PATH_INVALID')
  const repository = fileURLToPath(new URL('../../', import.meta.url))
  const source = fileURLToPath(new URL('./', import.meta.url))
  const lock = JSON.parse(
    await readFile(join(repository, 'package-lock.json'), 'utf8'),
  )
  const ws = lock.packages?.['node_modules/ws']
  if (
    ws?.version !== '8.22.0' ||
    ws.resolved !== 'https://registry.npmjs.org/ws/-/ws-8.22.0.tgz' ||
    !/^sha512-/.test(ws.integrity ?? '') ||
    ws.dependencies
  )
    throw new Error('PRINT_PACKAGE_LOCK_INVALID')
  await mkdir(destination, { mode: 0o700 })
  await mkdir(join(destination, 'scripts', 'print-bridge'), { recursive: true })
  const manifest = {
    name: 'komisio-weblink-runtime',
    version: '0.1.0',
    private: true,
    type: 'module',
    license: 'AGPL-3.0-or-later',
    engines: { node: '>=22.12.0' },
    dependencies: { ws: ws.version },
  }
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  )
  await writeFile(
    join(destination, 'package-lock.json'),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: manifest.name,
            version: manifest.version,
            license: manifest.license,
            engines: manifest.engines,
            dependencies: manifest.dependencies,
          },
          'node_modules/ws': ws,
        },
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  for (const file of [
    'auth.mjs',
    'attempts.mjs',
    'cli.mjs',
    'managed.mjs',
    'managed-cli.mjs',
    'setup-bundle.mjs',
    'credentials.mjs',
    'dispatch.mjs',
    'enrollment.mjs',
    'enrollment-store.mjs',
    'poller.mjs',
    'queue.mjs',
    'runtime.mjs',
    'service.mjs',
    'komisio-print.service',
    'komisio-weblink@.service',
  ])
    await copyFile(
      join(source, file),
      join(destination, 'scripts', 'print-bridge', file),
    )
  for (const file of ['LICENSE', 'NOTICE'])
    await copyFile(join(repository, file), join(destination, file))
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  packageRuntime(process.argv[2]).catch(() => {
    process.stderr.write('PRINT_PACKAGE_FAILED\n')
    process.exitCode = 1
  })
}
