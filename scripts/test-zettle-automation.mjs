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
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  throw new Error('Zettle automation browser fixture is local only')
const origin = 'http://127.0.0.1:3000'
try {
  await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })
  throw new Error('Stop the existing local app before running this fixture')
} catch (error) {
  if (error.message.startsWith('Stop the')) throw error
}
const password = `K!${randomBytes(24).toString('hex')}`
const ownerEmail = `zettle-owner-${randomUUID()}@example.test`
const staffEmail = `zettle-staff-${randomUUID()}@example.test`
const workerEmail = `zettle-worker-${randomUUID()}@example.test`
const merchant = randomUUID()
const setup = new pg.Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
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
  await fixture.db.query('select enable_zettle_pull($1,$2)', [
    fixture.tenant,
    merchant,
  ])
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
    ZETTLE_PILOT_TENANT_ID: fixture.tenant,
    ZETTLE_MERCHANT_ID: merchant,
    ZETTLE_CLIENT_ID: 'synthetic-not-a-client',
    ZETTLE_API_KEY: 'synthetic-not-a-key',
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
    await page.goto(`${origin}/intake/integrations`)
    await page
      .getByText(`PayPal POS · ${dictionary.integrationPage.manage}`, {
        exact: true,
      })
      .click()
    return page
  }
  const ownerPage = await login(ownerEmail)
  const text = dictionary.zettle
  const panel = ownerPage.getByRole('region', {
    name: text.pullTitle,
    exact: true,
  })
  await expect(
    panel.getByText(text.automaticDisabled, { exact: true }),
  ).toBeVisible()
  const enabledResponse = ownerPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/integrations/zettle') &&
      response.request().method() === 'POST',
  )
  await panel
    .getByRole('button', { name: text.automaticEnable, exact: true })
    .click()
  expect((await enabledResponse).status()).toBe(200)
  await expect(
    panel.getByText(text.automaticPending, { exact: true }),
  ).toBeVisible()
  const grant = (
    await setup.query(
      "select enabled_by,accepted_by,identity_email from automation_grants where tenant_id=$1 and scope='zettle_pull' and disabled_at is null",
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
  await ownerPage
    .getByText(`PayPal POS · ${dictionary.integrationPage.manage}`, {
      exact: true,
    })
    .click()
  await expect(
    panel.getByText(text.automaticEnabled, { exact: true }),
  ).toBeVisible()
  await fixture.asActor(worker, async () => {
    const job = (
      await fixture.db.query(
        'select prepare_zettle_automatic_pull($1,$2) job',
        [fixture.tenant, merchant],
      )
    ).rows[0].job
    expect(job.windowId).toBeNull()
    await fixture.db.query(
      "select finish_zettle_automatic_pull($1,$2,'waiting')",
      [fixture.tenant, job.id],
    )
  })
  await ownerPage.reload()
  await ownerPage
    .getByText(`PayPal POS · ${dictionary.integrationPage.manage}`, {
      exact: true,
    })
    .click()
  await expect(
    panel.getByText(new RegExp(text.automaticOutcomes.waiting)),
  ).toBeVisible()
  const staffPage = await login(staffEmail)
  await expect(
    staffPage.getByRole('button', { name: text.automaticEnable, exact: true }),
  ).toHaveCount(0)
  await expect(
    staffPage.getByRole('button', { name: text.automaticDisable, exact: true }),
  ).toHaveCount(0)
  for (const action of ['enableAutomaticPull', 'disableAutomaticPull']) {
    const response = await staffPage.request.post(
      `${origin}/api/integrations/zettle`,
      {
        headers: { origin },
        data: { action, tenantId: fixture.tenant, requestId: randomUUID() },
      },
    )
    expect(response.status()).toBe(403)
  }
  await panel
    .getByRole('button', { name: text.automaticDisable, exact: true })
    .click()
  await expect(
    panel.getByText(text.automaticDisabled, { exact: true }),
  ).toBeVisible()
  expect(
    (
      await setup.query(
        "select count(*)::int count from tenant_members where tenant_id=$1 and user_id=$2 and role='automation'",
        [fixture.tenant, worker],
      )
    ).rows[0].count,
  ).toBe(0)
  console.log(
    'PASS: owner enables, worker accepts, last outcome appears, staff cannot toggle, owner revokes. No provider HTTP.',
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
        fixture.db.query("select disable_automation($1,'zettle_pull')", [
          fixture.tenant,
        ]),
      )
    } finally {
      await fixture.close()
    }
  }
  await setup.end()
}
