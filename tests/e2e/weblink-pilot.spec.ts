import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { localTestUrl } from '../helpers/local-services'
import { enrollWeblinkDevice } from '../../scripts/print-bridge/enrollment.mjs'
import { createProvisionedWeblinkService } from '../../scripts/print-bridge/runtime.mjs'
import {
  MAIN_PROTOCOL,
  RAW_PROTOCOL,
} from '../../scripts/print-bridge/service.mjs'
import d from '../../messages/sv.json' with { type: 'json' }
const { WebSocket } = createRequire(import.meta.url)('ws')
const w = d.printing.weblink

for (const lost of [false, true])
  test(`Weblink pilot with real anonymous enrollment and ${lost ? 'lost' : 'confirmed'} activation`, async ({
    page,
  }, testInfo) => {
    const email = `weblink-pilot-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    const printer = randomUUID()
    const root = await mkdtemp(join(tmpdir(), 'komisio-pilot-e2e-'))
    let service:
      Awaited<ReturnType<typeof createProvisionedWeblinkService>> | undefined
    try {
      await f.db.query(
        "select register_weblink_printer($1,$2,'Synthetic pilot','ZD420',203)",
        [f.tenant, printer],
      )
      await f.commit()
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto('/settings?tab=printing')
      await page
        .getByRole('radio', { name: d.printing.setup.weblink, exact: false })
        .check()
      const fold = page.locator('.printing-printers > details').filter({
        has: page.locator('summary').filter({ hasText: 'Synthetic pilot' }),
      })
      await fold.locator('summary').first().click()
      await expect(fold.getByText(w.managed.unavailable)).toBeVisible()
      await expect(
        fold.getByRole('button', { name: w.enable, exact: true }),
      ).toHaveCount(0)
      await expect(
        fold.getByRole('button', { name: d.printing.newCode, exact: true }),
      ).toHaveCount(0)
      const pairingCode = await f.asActor(
        f.actor,
        async () =>
          (
            await f.db.query('select create_print_pairing_code($1,$2) value', [
              f.tenant,
              printer,
            ])
          ).rows[0].value.code,
      )
      const encryptionKey = randomBytes(32)
      const localConfig = parseEnv(
        await readFile(new URL('../../.env.local', import.meta.url), 'utf8'),
      )
      const endpoint = localTestUrl(
        'NEXT_PUBLIC_SUPABASE_URL',
        localConfig.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      )
      const publishableKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        localConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        localConfig.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      expect(publishableKey).toBeTruthy()
      const paired = await enrollWeblinkDevice({
        directory: join(root, 'enrollment'),
        encryptionKey,
        url: endpoint,
        publishableKey,
        tenantId: f.tenant,
        printerId: printer,
        deviceName: 'Synthetic bridge',
        pairingCode,
      })
      await fold.getByRole('button', { name: w.refreshDevices }).click()
      await expect(fold.getByLabel(w.pilotAcknowledged)).toBeVisible()
      await fold.getByLabel(w.pilotAcknowledged).check()
      let enables = 0
      await page.route('**/api/print/weblink', async (route) => {
        if (route.request().postDataJSON().action !== 'enablePilot')
          return route.continue()
        enables++
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (lost)
          await route.fulfill({
            status: 503,
            json: { error: 'REQUEST_FAILED' },
          })
        else await route.fulfill({ response })
      })
      await fold.getByRole('button', { name: w.enable, exact: true }).click()
      if (lost) {
        await expect(
          fold.locator('.weblink-pilot [role="alert"]'),
        ).toContainText(w.unconfirmed)
        await expect(
          fold.getByRole('button', { name: w.enable, exact: true }),
        ).toBeDisabled()
        await fold
          .getByRole('button', { name: d.intake.reload, exact: true })
          .click()
        await fold.locator('summary').first().click()
      }
      await expect(
        fold.getByRole('button', { name: w.pause, exact: true }),
      ).toBeVisible()
      expect(enables).toBe(1)
      const scope = {
        tenantId: f.tenant,
        printerId: printer,
        deviceId: paired.deviceId,
      }
      const proxySecret = randomBytes(32).toString('base64url')
      service = await createProvisionedWeblinkService({
        directory: paired.directory,
        encryptionKey,
        scope,
        url: endpoint,
        publishableKey,
        proxyHost: 'print.example.test',
        proxySecret,
      })
      const port = (service.address as { port: number }).port
      const headers = {
        Host: 'print.example.test',
        'X-Forwarded-Proto': 'https',
        'X-Komisio-Bridge': proxySecret,
        Authorization: `Basic ${Buffer.from(`${scope.deviceId}:${paired.password}`).toString('base64')}`,
      }
      const main = new WebSocket(
        `ws://127.0.0.1:${port}/weblink/${scope.deviceId}`,
        MAIN_PROTOCOL,
        { headers },
      )
      main.on('error', () => {})
      await once(main, 'open')
      const opened = once(main, 'message')
      main.send(Buffer.from('{"discovery_b64":"VEVTVA=="}'))
      await opened
      const raw = new WebSocket(
        `ws://127.0.0.1:${port}/weblink/${scope.deviceId}`,
        RAW_PROTOCOL,
        { headers },
      )
      raw.on('error', () => {})
      await once(raw, 'open')
      const labels: string[] = []
      raw.on('message', (data: Buffer) => labels.push(data.toString()))
      raw.send(
        Buffer.from(
          JSON.stringify({
            unique_id: 'synthetic',
            channel_name: RAW_PROTOCOL,
            channel_id: '2',
          }),
        ),
      )
      await expect.poll(() => service!.status().connected).toBe(true)
      const job = randomUUID()
      await f.asActor(f.actor, () =>
        f.db.query(
          "select queue_print_job($1,$2,$3,'onboarding','zpl-v1','seller',$4,'^XA^FDPILOT TEST^FS^XZ',1)",
          [f.tenant, job, printer, f.seller],
        ),
      )
      expect((await service.runOnce()).state).toBe('transport_accepted')
      await expect.poll(() => labels.length).toBe(1)
      expect(labels).toEqual(['^XA^FDPILOT TEST^FS^XZ'])
      expect(
        (await f.db.query('select status from print_jobs where id=$1', [job]))
          .rows[0].status,
      ).toBe('transport_accepted')
      await service.reportStatus(false)
      await fold.getByRole('button', { name: w.pause, exact: true }).click()
      await expect(fold.locator('summary').first()).toContainText(
        d.printing.inactiveLabel,
      )
      // A pause racing the durable attempt fences output and conservatively
      // holds the attempt. Neither resuming the UI nor reconnecting may resend.
      expect((await service.runOnce()).state).toBe('claim_unknown')
      expect((await service.runOnce()).state).toBe('held')
      await expect(fold.locator('.print-devices')).toContainText(
        d.printing.deviceSeen,
      )
      expect(labels).toHaveLength(1)
      expect(
        (await f.db.query('select status from print_jobs where id=$1', [job]))
          .rows[0].status,
      ).toBe('transport_accepted')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(375)
      await page.screenshot({
        path: testInfo.outputPath('pilot-mobile.png'),
        fullPage: true,
      })
    } finally {
      await service?.close()
      await f.close()
      expect(dirname(resolve(root))).toBe(resolve(tmpdir()))
      expect(basename(root).startsWith('komisio-pilot-e2e-')).toBe(true)
      await rm(root, { recursive: true, force: true })
    }
  })
