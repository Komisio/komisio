import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { WebSocket } from 'ws'
import { issuePrinterCredential } from '../../scripts/print-bridge/auth.mjs'
import { createCredentialStore } from '../../scripts/print-bridge/credentials.mjs'
import { createProvisionedWeblinkService } from '../../scripts/print-bridge/runtime.mjs'
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

test(
  'provisioned runtime uses persisted device refresh, scoped RPC and durable hold across restart',
  { timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'komisio-runtime-'))
    const directory = join(root, 'device')
    const encryptionKey = randomBytes(32)
    const secret = issuePrinterCredential()
    const proxySecret = issuePrinterCredential().password
    const store = await createCredentialStore(directory, encryptionKey)
    let service
    t.after(async () => {
      await service?.close()
      assert.equal(dirname(resolve(root)), resolve(tmpdir()))
      assert.ok(basename(root).startsWith('komisio-runtime-'))
      await rm(root, { recursive: true, force: true })
    })
    let refresh = 0,
      claims = 0,
      contexts = 0
    const config = {
      directory,
      encryptionKey,
      scope,
      url: 'https://example.com',
      publishableKey: 'sb_publishable_fixture',
      proxyHost: 'print.example.com',
      proxySecret,
      fetchImpl: async (url, request) => {
        const path = new URL(url).pathname
        assert.equal(request.redirect, 'error')
        if (path === '/auth/v1/token') {
          assert.equal(
            JSON.parse(request.body).refresh_token,
            `refresh-${refresh}`,
          )
          refresh++
          return Response.json({
            access_token: `access-${refresh}`,
            refresh_token: `refresh-${refresh}`,
            expires_in: 3600,
          })
        }
        // Refresh rotation must already be durable before any device API request.
        assert.equal(
          (await store.load(scope.deviceId)).refreshToken,
          `refresh-${refresh}`,
        )
        assert.equal(request.headers.Authorization, `Bearer access-${refresh}`)
        if (path.endsWith('/print_device_context')) {
          contexts++
          return Response.json({ ...scope, active: true, transport: 'weblink' })
        }
        const args = JSON.parse(request.body)
        assert.equal(args.p_tenant, scope.tenantId)
        if (path.endsWith('/claim_weblink_print_job')) {
          claims++
          assert.equal(args.p_printer, scope.printerId)
          return Response.json({
            jobId,
            attemptId: args.p_attempt,
            state: 'dispatching',
            canSend: true,
            payload: '^XA^FDTEST^FS^XZ',
            copies: 1,
          })
        }
        assert.ok(path.endsWith('/finish_weblink_print_job'))
        assert.equal(args.p_outcome, 'transport_accepted')
        throw Error('lost completion reply')
      },
    }
    await assert.rejects(
      createProvisionedWeblinkService(config),
      /PRINT_SERVICE_UNAVAILABLE/,
    )
    await store.save({
      ...scope,
      secretDigest: secret.secretDigest,
      refreshToken: 'refresh-0',
    })

    async function connect() {
      const channels = []
      for (const protocol of [MAIN_PROTOCOL, RAW_PROTOCOL]) {
        const ws = new WebSocket(
          `ws://127.0.0.1:${service.address.port}/weblink/${scope.deviceId}`,
          protocol,
          {
            headers: {
              Host: config.proxyHost,
              'X-Forwarded-Proto': 'https',
              'X-Komisio-Bridge': proxySecret,
              Authorization: `Basic ${Buffer.from(`${scope.deviceId}:${secret.password}`).toString('base64')}`,
            },
          },
        )
        ws.on('error', () => {})
        await once(ws, 'open')
        channels.push(ws)
        if (protocol === MAIN_PROTOCOL) {
          const reply = once(ws, 'message')
          ws.send(Buffer.from('{"discovery_b64":"VEVTVA=="}'))
          await reply
        } else {
          ws.send(
            Buffer.from(
              JSON.stringify({
                unique_id: 'fixture',
                channel_name: RAW_PROTOCOL,
                channel_id: '2',
              }),
            ),
          )
          const pong = once(ws, 'pong')
          ws.ping()
          await pong
        }
      }
      return channels[1]
    }

    service = await createProvisionedWeblinkService(config)
    assert.equal(
      refresh,
      0,
      'starting a runtime does not contact Auth or claim work',
    )
    await assert.rejects(
      createProvisionedWeblinkService(config),
      /PRINT_ATTEMPT_STORE_LOCKED/,
    )
    const raw = await connect()
    const printedBytes = once(raw, 'message')
    const first = await service.runOnce()
    assert.equal(first.state, 'outcome_unknown')
    assert.equal((await printedBytes)[0].toString(), '^XA^FDTEST^FS^XZ')
    assert.equal(refresh, 1)
    assert.equal(claims, 1)
    assert.ok(contexts >= 5)
    assert.ok(
      !(
        await readFile(join(directory, `${scope.deviceId}.sealed`), 'utf8')
      ).includes('refresh-1'),
    )
    await service.close()
    service = await createProvisionedWeblinkService(config)
    await connect()
    assert.equal(refresh, 2)
    assert.deepEqual(await service.runOnce(), {
      state: 'held',
      attemptId: first.attemptId,
      jobId,
    })
    assert.equal(claims, 1, 'restart cannot claim again after uncertain output')
  },
)
