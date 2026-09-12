import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Assistance browser fixture is local only')
try {
  await fetch('http://127.0.0.1:3000/login', {
    signal: AbortSignal.timeout(1000),
  })
  throw new Error(
    'Stop the existing local app before running the isolated fixture',
  )
} catch (e) {
  if (e.message.startsWith('Stop the')) throw e
}
const env = {
  ...process.env,
  CI: '',
  KOMISIO_INTAKE_ENABLED: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  KOMISIO_TEST_AI_HTTP_FIXTURE: 'enabled',
  KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
  KOMISIO_RECEPTION_AI_KEY: 'komisio-http-fixture-not-a-key',
  KOMISIO_RECEPTION_AI_MODEL: 'komisio-http-fixture',
  KOMISIO_RECEPTION_AI_TENANTS: randomUUID(),
}
const server = spawn(
  process.execPath,
  ['--import', './tests/fixtures/reception-provider.mjs', 'scripts/start.mjs'],
  { env, stdio: 'inherit', windowsHide: true },
)
let failure
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Fixture server exited')
    try {
      const r = await fetch('http://127.0.0.1:3000/login')
      if (r.ok) {
        ready = true
        break
      }
    } catch {}
    await pause(500)
  }
  if (!ready) throw new Error('Fixture server did not start')
  const runner = spawn(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--grep',
      'AI HTTP fixture',
    ],
    { env, stdio: 'inherit', windowsHide: true },
  )
  const result = await new Promise((resolve) => runner.once('exit', resolve))
  if (result !== 0) throw new Error('Assistance browser fixture failed')
} catch (e) {
  failure = e
} finally {
  server.kill()
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve()
    else server.once('exit', resolve)
  })
}
if (failure) throw failure
