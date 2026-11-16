import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { register } from '../helpers/account'
import { localTestUrl } from '../helpers/local-services'

test('in-app API receipt and host handling survive a lost response without erasure', async ({
  page,
}, testInfo) => {
  const email = `deletion-ui-${randomUUID()}@example.test`,
    password = `K!${randomUUID()}`
  await page.goto('/login')
  const signedOut = await page.request.post('/api/host/account-deletion', {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      kind: 'processing',
      eventId: randomUUID(),
      requestId: randomUUID(),
      expected: null,
      evidence: {},
    },
  })
  expect(signedOut.status()).toBe(401)
  expect(await signedOut.json()).toEqual({ error: 'AUTH_REQUIRED' })
  await register(page, email, password)
  const config = parseEnv(
    readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
  )
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!key) throw new Error('Local public client key missing')
  const api = createClient(
    localTestUrl(
      'NEXT_PUBLIC_SUPABASE_URL',
      config.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    ),
    key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const login = await api.auth.signInWithPassword({ email, password })
  expect(login.error).toBeNull()
  const user = login.data.user!,
    token = login.data.session!.access_token
  const { Client } = createRequire(import.meta.url)('pg')
  const db = new Client({
    connectionString: localTestUrl(
      'TEST_DATABASE_URL',
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    ),
  })
  await db.connect()
  try {
    const requestId = randomUUID()
    const submit = (body: object) =>
      page.request.post('/api/mobile/v1/account-deletion', {
        headers: { Authorization: `Bearer ${token}` },
        data: body,
      })
    expect(
      (
        await submit({
          action: 'request',
          requestId,
          locale: 'sv',
          confirmed: false,
        })
      ).status(),
    ).toBe(400)
    const first = await submit({
      action: 'request',
      requestId,
      locale: 'sv',
      confirmed: true,
    })
    expect(first.status()).toBe(200)
    expect((await first.json()).request.status).toBe('requested')
    expect(
      (
        await (
          await submit({
            action: 'request',
            requestId: randomUUID(),
            locale: 'en',
            confirmed: true,
          })
        ).json()
      ).request.id,
    ).toBe(requestId)
    const denied = await page.request.post('/api/host/account-deletion', {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        kind: 'processing',
        eventId: randomUUID(),
        requestId,
        expected: null,
        evidence: {},
      },
    })
    expect(denied.status()).toBe(403)
    await db.query(
      "insert into platform_hosts(user_id,kind) values($1,'person')",
      [user.id],
    )
    await page.context().addCookies([
      {
        name: 'komisio-locale',
        value: 'sv',
        url: new URL(page.url()).origin,
      },
    ])
    await page.goto('/host/account-deletion')
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: email, exact: true }) })
    await expect(card.getByText('Mottagen', { exact: true })).toBeVisible()
    await page.route(
      '**/api/host/account-deletion',
      async (route) => {
        await route.fetch()
        await route.abort('connectionfailed')
      },
      { times: 1 },
    )
    await card.getByRole('button', { name: 'Påbörja handläggning' }).click()
    await expect(card.getByRole('alert')).toContainText(
      'Resultatet kunde inte bekräftas',
    )
    await card.getByRole('button', { name: 'Läs in på nytt' }).click()
    await expect(card.getByText('Handläggs', { exact: true })).toBeVisible()
    await expect(
      card.getByRole('button', { name: 'Registrera slutförd radering' }),
    ).toBeDisabled()
    expect(
      (await (await submit({ action: 'state' })).json()).request.status,
    ).toBe('processing')
    expect(
      (
        await db.query('select deleted_at from auth.users where id=$1', [
          user.id,
        ])
      ).rows[0].deleted_at,
    ).toBeNull()
    expect(
      (
        await db.query(
          'select count(*)::int n from account_deletion_events where request_id=$1',
          [requestId],
        )
      ).rows[0].n,
    ).toBe(1)
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(
        card.getByRole('heading', { name: email, exact: true }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`account-deletion-${width}.png`),
        fullPage: true,
      })
    }
  } finally {
    await api.auth.signOut()
    await db.end()
  }
})
