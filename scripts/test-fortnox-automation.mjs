import { localTestUrl } from '../tests/helpers/local-services.ts'
import { openAccountingSettings } from '../tests/helpers/accounting-settings.ts'
import { spawn } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { setTimeout as pause } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { chromium, expect } from '@playwright/test'
import pg from 'pg'
import { p2Fixture } from '../tests/helpers/p2-fixture.ts'
import dictionary from '../messages/sv.json' with { type: 'json' }

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL !==
  localTestUrl('TEST_SUPABASE_URL', 'http://127.0.0.1:54321')
)
  throw new Error('Fortnox automation browser fixture is local only')
const origin = new URL(localTestUrl('TEST_APP_URL', 'http://127.0.0.1:3000'))
  .origin
const databaseUrl = localTestUrl(
  'TEST_DATABASE_URL',
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)
try {
  await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })
  throw new Error('Stop the existing local app before running this fixture')
} catch (error) {
  if (error.message.startsWith('Stop the')) throw error
}
const password = `K!${randomBytes(24).toString('hex')}`
const ownerEmail = `fortnox-owner-${randomUUID()}@example.test`
const staffEmail = `fortnox-staff-${randomUUID()}@example.test`
const workerEmail = `fortnox-worker-${randomUUID()}@example.test`
const setup = new pg.Client({
  connectionString: databaseUrl,
})
await setup.connect()
let fixture, server, browser
try {
  const accounts = []
  for (const email of [ownerEmail, staffEmail, workerEmail]) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const result = await client.auth.signUp({ email, password })
    if (result.error || !result.data.user)
      throw new Error('Fixture signup failed')
    accounts.push(result.data.user.id)
    await setup.query(
      'update auth.users set email_confirmed_at=now() where id=$1',
      [result.data.user.id],
    )
  }
  const [, staff, worker] = accounts
  fixture = await p2Fixture(ownerEmail)
  await fixture.commit()
  await setup.query(
    "insert into tenant_members(tenant_id,user_id,role) values($1,$2,'staff')",
    [fixture.tenant, staff],
  )
  await fixture.asActor(staff, () =>
    fixture.db.query('select set_active_tenant($1)', [fixture.tenant]),
  )
  const env = {
    ...process.env,
    KOMISIO_INTAKE_ENABLED: 'true',
    NEXT_PUBLIC_APP_URL: origin,
    PORT: new URL(origin).port,
    FORTNOX_PILOT_TENANT_ID: fixture.tenant,
    KOMISIO_AUTOMATION_EMAIL: workerEmail,
    KOMISIO_AUTOMATION_PASSWORD: password,
    CRON_SECRET: '',
  }
  server = spawn(
    process.execPath,
    ['--import', './tests/fixtures/local-fetch-only.mjs', 'scripts/start.mjs'],
    {
      env,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Fixture server exited')
    try {
      const response = await fetch(`${origin}/login`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {}
    await pause(500)
  }
  if (!ready) throw new Error('Fixture server did not start')
  browser = await chromium.launch()
  const login = async (email) => {
    const context = await browser.newContext()
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      return ['127.0.0.1', 'localhost'].includes(url.hostname)
        ? route.continue()
        : route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.setDefaultNavigationTimeout(30000)
    await page.goto(`${origin}/login`)
    await page.getByLabel('E-postadress', { exact: true }).fill(email)
    await page.getByLabel('Lösenord', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Logga in', exact: true }).click()
    await expect(page).not.toHaveURL(/\/login/)
    await page.goto(`${origin}/intake/accounting?view=settings`)
    await openAccountingSettings(page)
    return page
  }
  const ownerPage = await login(ownerEmail)
  const text = dictionary.fortnox.automation
  const panel = ownerPage.getByRole('region', {
    name: text.heading,
    exact: true,
  })
  await expect(panel.getByText(text.off, { exact: true })).toBeVisible()
  const time = panel.getByLabel(text.timeLabel, { exact: true })
  await expect(time).toHaveValue('07:00')
  await time.fill('')
  await expect(
    panel.getByRole('button', { name: text.saveTime, exact: true }),
  ).toBeDisabled()
  const invalid = await ownerPage.request.post(
    `${origin}/api/fortnox-schedule`,
    {
      headers: { origin },
      data: {
        tenantId: fixture.tenant,
        requestId: randomUUID(),
        previousId: null,
        time: '24:00',
      },
    },
  )
  expect(invalid.status()).toBe(400)
  await time.fill('11:37')
  let lost = false
  await ownerPage.route('**/api/fortnox-schedule', async (route) => {
    if (lost) return route.continue()
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    lost = true
    await route.abort()
  })
  await panel.getByRole('button', { name: text.saveTime, exact: true }).click()
  await expect(
    panel.getByText(text.timeUncertain, { exact: true }),
  ).toBeVisible()
  await panel
    .getByRole('button', { name: dictionary.intake.retry, exact: true })
    .click()
  await expect(time).toBeEnabled()
  await expect(panel).toContainText(text.hint.replace('{time}', '11:37'))
  await ownerPage.reload()
  await openAccountingSettings(ownerPage)
  await expect(time).toHaveValue('11:37')
  await time.fill('00:00')
  await panel.getByRole('button', { name: text.saveTime, exact: true }).click()
  await expect(panel).toContainText(text.hint.replace('{time}', '00:00'))
  const enabledResponse = ownerPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/automation-grants') &&
      response.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: text.enable, exact: true }).click()
  expect((await enabledResponse).status()).toBe(200)
  await expect(panel.getByText(text.waiting, { exact: true })).toBeVisible()
  const grant = (
    await setup.query(
      "select enabled_by,accepted_by,identity_email from automation_grants where tenant_id=$1 and scope='fortnox_send' and disabled_at is null",
      [fixture.tenant],
    )
  ).rows
  expect(grant).toEqual([
    {
      enabled_by: fixture.actor,
      accepted_by: null,
      identity_email: workerEmail,
    },
  ])
  await fixture.asActor(worker, () =>
    fixture.db.query('select accept_automation_grants()'),
  )
  await ownerPage.reload()
  await openAccountingSettings(ownerPage)
  await expect(panel.getByText(text.enabled, { exact: true })).toBeVisible()
  // Independent connections race for the same local day. Exactly one may dispatch.
  const contenders = [0, 1].map(
    () => new pg.Client({ connectionString: databaseUrl }),
  )
  const requests = [randomUUID(), randomUUID()]
  let claimed
  try {
    await Promise.all(contenders.map((c) => c.connect()))
    claimed = await Promise.all(
      contenders.map(async (c, index) => {
        await c.query('begin')
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: worker, role: 'authenticated' }),
        ])
        const result = await c.query(
          'select begin_fortnox_automatic_run($1,$2) claimed',
          [fixture.tenant, requests[index]],
        )
        await c.query('commit')
        return result.rows[0].claimed
      }),
    )
  } finally {
    await Promise.all(contenders.map((c) => c.end()))
  }
  expect(claimed.filter(Boolean)).toHaveLength(1)
  const winner = requests[claimed.indexOf(true)]
  await fixture.asActor(worker, () =>
    fixture.db.query(
      "select finish_fortnox_automatic_run($1,$2,'complete',0)",
      [fixture.tenant, winner],
    ),
  )
  const repeated = await fixture.asActor(worker, () =>
    fixture.db.query('select begin_fortnox_automatic_run($1,$2) claimed', [
      fixture.tenant,
      randomUUID(),
    ]),
  )
  expect(repeated.rows[0].claimed).toBe(false)
  await ownerPage.reload()
  await openAccountingSettings(ownerPage)
  await expect(ownerPage.getByText(new RegExp(text.complete))).toBeVisible()
  const staffPage = await login(staffEmail)
  await expect(
    staffPage.getByRole('button', { name: text.enable, exact: true }),
  ).toHaveCount(0)
  await expect(
    staffPage.getByRole('button', { name: text.disable, exact: true }),
  ).toHaveCount(0)
  const refusedTime = await staffPage.request.post(
    `${origin}/api/fortnox-schedule`,
    {
      headers: { origin },
      data: {
        tenantId: fixture.tenant,
        requestId: randomUUID(),
        previousId: null,
        time: '11:37',
      },
    },
  )
  expect(refusedTime.status()).toBe(403)
  for (const action of ['enable', 'disable']) {
    const response = await staffPage.request.post(
      `${origin}/api/automation-grants`,
      {
        headers: { origin },
        data: { action, tenantId: fixture.tenant, scope: 'fortnox_send' },
      },
    )
    expect(response.status()).toBe(403)
  }
  await panel.getByRole('button', { name: text.disable, exact: true }).click()
  await expect(panel.getByText(text.off, { exact: true })).toBeVisible()
  expect(
    (
      await setup.query(
        "select count(*)::int count from tenant_members where tenant_id=$1 and user_id=$2 and role='automation'",
        [fixture.tenant, worker],
      )
    ).rows[0].count,
  ).toBe(0)
  await ownerPage.reload()
  await openAccountingSettings(ownerPage)
  await expect(time).toHaveValue('00:00')
  await ownerPage.setViewportSize({ width: 320, height: 800 })
  expect(
    await ownerPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await panel.screenshot({ path: 'private/fortnox-send-time-mobile.png' })
  console.log(
    'PASS: owner saves time, lost response retries safely, renewal retains time, concurrent claims serialize, staff changes are denied, mobile fits. No provider HTTP.',
  )
} finally {
  await browser?.close()
  if (server) {
    server.kill()
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once('exit', resolve),
    )
  }
  if (fixture) {
    try {
      await fixture.asActor(fixture.actor, () =>
        fixture.db.query("select disable_automation($1,'fortnox_send')", [
          fixture.tenant,
        ]),
      )
    } finally {
      await fixture.close()
    }
  }
  await setup.end()
}
