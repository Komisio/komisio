import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { issuePrinterCredential } from '../../scripts/print-bridge/auth.mjs'
import { packageRuntime } from '../../scripts/print-bridge/package-runtime.mjs'
import {
  loadOperatorConfig,
  printerSetup,
} from '../../scripts/print-bridge/cli.mjs'
import {
  MAIN_PROTOCOL,
  RAW_PROTOCOL,
} from '../../scripts/print-bridge/service.mjs'

const scope = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  printerId: '20000000-0000-4000-8000-000000000002',
  deviceId: '30000000-0000-4000-8000-000000000003',
}
const jobId = '50000000-0000-4000-8000-000000000005'
const userId = '40000000-0000-4000-8000-000000000004'

test('runtime packaging includes only the pinned transport and refuses overwriting an existing release', async (t) => {
  const root = await temporary(t)
  const destination = join(root, 'release')
  await packageRuntime(destination)
  const manifest = JSON.parse(
    await readFile(join(destination, 'package.json'), 'utf8'),
  )
  const lock = JSON.parse(
    await readFile(join(destination, 'package-lock.json'), 'utf8'),
  )
  assert.deepEqual(manifest.dependencies, { ws: '8.22.0' })
  assert.deepEqual(Object.keys(lock.packages), ['', 'node_modules/ws'])
  assert.ok(
    (
      await readFile(
        join(destination, 'scripts', 'print-bridge', 'cli.mjs'),
        'utf8',
      )
    ).includes('enrollWeblinkDevice'),
  )
  await assert.rejects(packageRuntime(destination), { code: 'EEXIST' })
})
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'komisio-cli-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('komisio-cli-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}

test('printer setup uses only the host/device credential and cannot inject SGD commands', () => {
  const password = issuePrinterCredential().password
  const zpl = printerSetup('print.example.com', { ...scope, password })
  assert.ok(
    zpl.includes(
      `authentication.add" "print.example.com ${scope.deviceId} ${password}"`,
    ),
  )
  assert.ok(zpl.includes(`https://print.example.com/weblink/${scope.deviceId}`))
  assert.ok(!zpl.includes('reset'))
  for (const host of [
    'print.example.com"',
    'https://print.example.com',
    'a\r\n! U1',
  ])
    assert.throws(() => printerSetup(host, { ...scope, password }))
})

test('operator config rejects relative paths and malformed keys without outputting their values', async (t) => {
  const root = await temporary(t)
  const config = {
    ...scope,
    url: 'https://example.com',
    publishableKey: 'sb_publishable_fixture',
    host: 'print.example.com',
    port: 18654,
    pollMs: 1000,
    enrollmentDirectory: join(root, 'enrollment'),
    encryptionKeyFile: join(root, 'key'),
    proxySecretFile: join(root, 'proxy'),
  }
  await writeFile(config.encryptionKeyFile, randomBytes(32), { mode: 0o600 })
  const path = join(root, 'config.json')
  await writeFile(path, JSON.stringify(config), { mode: 0o600 })
  assert.equal((await loadOperatorConfig(path)).encryptionKey.length, 32)
  await writeFile(
    path,
    JSON.stringify({ ...config, encryptionKeyFile: './private-key' }),
  )
  await assert.rejects(loadOperatorConfig(path), /PRINT_OPERATOR_INPUT_INVALID/)
  await writeFile(path, JSON.stringify(config))
  await writeFile(config.encryptionKeyFile, 'private-value')
  await assert.rejects(loadOperatorConfig(path), /PRINT_OPERATOR_INPUT_INVALID/)
})

test(
  'Linux CLI enrollment, daemon polling, held restart and SIGTERM use real HTTP/WebSockets',
  { skip: process.platform === 'win32', timeout: 20000 },
  async (t) => {
    const root = await temporary(t)
    const proxySecret = issuePrinterCredential().password
    let refresh = 0,
      claims = 0,
      pairings = 0,
      reports = 0
    const backend = createServer(async (req, res) => {
      let text = ''
      for await (const chunk of req) text += chunk
      const body = JSON.parse(text || '{}')
      res.setHeader('Content-Type', 'application/json')
      if (req.url.startsWith('/auth/v1/')) {
        refresh++
        res.end(
          JSON.stringify({
            access_token: `access-${refresh}`,
            refresh_token: `refresh-${refresh}`,
            user: { id: userId, is_anonymous: true },
            expires_in: 3600,
          }),
        )
      } else if (req.url.endsWith('/pair_print_device')) {
        pairings++
        res.end(JSON.stringify(scope))
      } else if (req.url.endsWith('/print_device_context'))
        res.end(
          JSON.stringify({ ...scope, transport: 'weblink', active: true }),
        )
      else if (req.url.endsWith('/report_print_device')) {
        reports++
        res.end('null')
      } else if (req.url.endsWith('/claim_weblink_print_job')) {
        claims++
        res.end(
          JSON.stringify({
            jobId,
            attemptId: body.p_attempt,
            canSend: true,
            state: 'dispatching',
            payload: '^XA^FDCLI TEST^FS^XZ',
            copies: 1,
          }),
        )
      } else {
        res.statusCode = 503
        res.end('{}')
      }
    })
    backend.listen(0, '127.0.0.1')
    await once(backend, 'listening')
    const reserve = createServer()
    reserve.listen(0, '127.0.0.1')
    await once(reserve, 'listening')
    const port = reserve.address().port
    await new Promise((resolve) => reserve.close(resolve))
    const config = {
      ...scope,
      deviceName: 'Fixture Zebra',
      url: `http://127.0.0.1:${backend.address().port}`,
      publishableKey: 'sb_publishable_fixture',
      host: 'print.example.com',
      port,
      pollMs: 1000,
      enrollmentDirectory: join(root, 'enrollment'),
      encryptionKeyFile: join(root, 'key'),
      proxySecretFile: join(root, 'proxy'),
    }
    await writeFile(config.encryptionKeyFile, randomBytes(32), { mode: 0o600 })
    await writeFile(config.proxySecretFile, proxySecret, { mode: 0o600 })
    const path = join(root, 'config.json')
    await writeFile(path, JSON.stringify(config), { mode: 0o600 })
    const children = []
    t.after(async () => {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL')
      backend.closeAllConnections()
      await new Promise((resolve) => backend.close(resolve))
    })
    function child(action, stdin = '') {
      const process = spawn(
        globalThis.process.execPath,
        [
          fileURLToPath(
            new URL('../../scripts/print-bridge/cli.mjs', import.meta.url),
          ),
          action,
          path,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )
      children.push(process)
      let output = ''
      process.stdout.on('data', (data) => {
        output += data
      })
      process.stderr.on('data', (data) => {
        output += data
      })
      const finished = once(process, 'exit')
      process.stdin.end(stdin)
      return { process, finished, output: () => output }
    }
    const enrollment = child('enroll', 'A1234-B5678\n')
    assert.equal((await enrollment.finished)[0], 0)
    assert.equal(
      enrollment.output(),
      '{"state":"paired","next":"configure-printer"}\n',
    )
    const setup = await readFile(
      join(config.enrollmentDirectory, 'printer-setup.zpl'),
      'utf8',
    )
    const password =
      /authentication.add" "[^ ]+ [^ ]+ ([A-Za-z0-9_-]{43})"/.exec(setup)[1]
    async function waitFor(predicate) {
      const end = Date.now() + 5000
      while (!predicate()) {
        if (Date.now() > end) assert.fail('timed out')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    async function connect() {
      let raw
      for (const protocol of [MAIN_PROTOCOL, RAW_PROTOCOL]) {
        const ws = new WebSocket(
          `ws://127.0.0.1:${port}/weblink/${scope.deviceId}`,
          protocol,
          {
            headers: {
              Host: config.host,
              'X-Komisio-Bridge': proxySecret,
              'X-Forwarded-Proto': 'https',
              Authorization: `Basic ${Buffer.from(`${scope.deviceId}:${password}`).toString('base64')}`,
            },
          },
        )
        ws.on('error', () => {})
        await once(ws, 'open')
        if (protocol === MAIN_PROTOCOL) {
          const reply = once(ws, 'message')
          ws.send(Buffer.from('{"discovery_b64":"VEVTVA=="}'))
          await reply
        } else {
          raw = ws
          ws.send(
            Buffer.from(
              JSON.stringify({
                unique_id: 'fixture',
                channel_name: RAW_PROTOCOL,
                channel_id: '2',
              }),
            ),
          )
        }
      }
      return raw
    }
    for (const iteration of [1, 2]) {
      const daemon = child('run')
      await waitFor(() => daemon.output().includes('waiting'))
      const raw = await connect()
      const received = []
      raw.on('message', (data) => received.push(data.toString()))
      await waitFor(() => daemon.output().includes('held'))
      assert.deepEqual(
        received,
        iteration === 1 ? ['^XA^FDCLI TEST^FS^XZ'] : [],
      )
      assert.equal(claims, 1)
      assert.equal(pairings, 1)
      assert.ok(!daemon.output().includes(password))
      daemon.process.kill('SIGTERM')
      assert.equal((await daemon.finished)[0], 0)
    }
    assert.ok(reports >= 2)
  },
)
