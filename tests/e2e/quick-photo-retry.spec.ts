import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Quick reception photo phases (create reception, upload, save source) with
// one reply lost after the server committed. Only local synthetic stores,
// sellers and an 8×8 PNG; no printer, AI provider, sale or payment.

type Fixture = Awaited<ReturnType<typeof p2Fixture>>

async function png() {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#7a5c3e' },
  })
    .png()
    .toBuffer()
}

/** Opens quick reception for the fixture seller at phone width. */
async function openQuick(page: Page, email: string) {
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  await f.commit()
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/intake/quick')
  await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
  let assistanceCalls = 0
  await page.route('**/api/reception/assistance', (route) => {
    assistanceCalls += 1
    return route.abort()
  })
  return { f, assistanceCalls: () => assistanceCalls }
}

function panel(page: Page) {
  const panel = page.locator('.quick-photo-panel')
  return {
    panel,
    alert: panel.getByRole('alert'),
    retry: panel.getByRole('button', {
      name: d.quickIntake.retry,
      exact: true,
    }),
    reload: panel.getByRole('button', {
      name: d.quickIntake.reload,
      exact: true,
    }),
    preview: panel.locator('.quick-photo-picker img'),
    input: page.locator('#quick-photo'),
    submit: page.locator('.quick-finish').getByRole('button'),
  }
}

async function choosePhoto(page: Page, buffer: Buffer, name = 'retry.png') {
  // The input is enabled only once React handles its change event.
  const input = page.locator('#quick-photo')
  await expect(input).toBeEnabled()
  await input.setInputFiles({ name, mimeType: 'image/png', buffer })
}

/** The visible photo is unresolved: no replacement, no photoless item. */
async function expectUnresolved(
  page: Page,
  text = d.quickIntake.photoUncertain,
) {
  const p = panel(page)
  await expect(p.alert).toContainText(text)
  await expect(p.preview).toBeVisible()
  await expect(p.input).toBeDisabled()
  await expect(p.submit).toBeDisabled()
  // The new native form must not turn unresolved photos into photoless items.
  const price = page.getByLabel(d.quickIntake.price, { exact: true })
  await price.fill('120')
  await price.press('Enter')
  await page
    .locator('.quick-item form')
    .evaluate((form) => (form as HTMLFormElement).requestSubmit())
  await expect(p.alert).toContainText(text)
  await expect(page.locator('.quick-done')).toHaveCount(0)
  await expect(p.retry).toBeEnabled()
  await expect(p.reload).toBeVisible()
  await expect(
    page.getByRole('button', { name: d.quickIntake.changeSeller, exact: true }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
}

/** Clicks the photo retry and waits for the source save to be confirmed. */
async function retryUntilSaved(page: Page) {
  const p = panel(page)
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/intake') &&
      r.request().postDataJSON()?.action === 'saveReceptionSources' &&
      r.status() === 200,
  )
  await p.retry.click()
  await saved
  await expect(p.alert).toHaveCount(0)
  await expect(p.retry).toHaveCount(0)
  await expect(p.preview).toBeVisible()
  await expect(p.input).toBeDisabled() // a saved photo is not replaced
  await expect(p.submit).toBeEnabled()
}

/** One reception, one revision holding one photo, two stored objects. */
async function expectOnePhoto(f: Fixture, sessionId?: string) {
  const sessions = (
    await f.db.query('select id from reception_sessions where tenant_id=$1', [
      f.tenant,
    ])
  ).rows as { id: string }[]
  expect(sessions).toHaveLength(1)
  if (sessionId) expect(sessions[0].id).toBe(sessionId)
  const session = sessions[0].id
  const revisions = (
    await f.db.query(
      'select revision, sources from reception_source_revisions where tenant_id=$1 and session_id=$2 order by revision',
      [f.tenant, session],
    )
  ).rows as { revision: number; sources: { kind: string; id: string }[] }[]
  expect(revisions.map((r) => r.revision)).toEqual([1])
  expect(revisions[0].sources.filter((s) => s.kind === 'photo')).toHaveLength(1)
  const objects = (
    await f.db.query(
      'select bucket_id, name from storage.objects where name like $1 order by bucket_id',
      [`${f.tenant}/${session}/%`],
    )
  ).rows as { bucket_id: string; name: string }[]
  expect(objects.map((o) => o.bucket_id)).toEqual([
    'reception-photos',
    'seller-reception-photos',
  ])
  const photoId = revisions[0].sources[0].id
  for (const o of objects) expect(o.name).toContain(`/${photoId}.`)
  return { session, photoId }
}

/** Sends the actual request, keeps its body, and hides it behind a 503. */
async function hideOnce(
  page: Page,
  url: string,
  match: (body: Record<string, unknown> | null, url: string) => boolean,
) {
  const seen: { body: Record<string, unknown> | null; url: string }[] = []
  let hidden: { status: number; body: unknown } | undefined
  await page.route(url, async (route) => {
    const request = route.request()
    let body: Record<string, unknown> | null = null
    try {
      body = request.postDataJSON()
    } catch {
      body = null
    }
    if (!match(body, request.url())) return route.continue()
    seen.push({ body, url: request.url() })
    if (seen.length !== 1) return route.continue()
    const response = await route.fetch()
    hidden = { status: response.status(), body: await response.json() }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'REQUEST_FAILED' }),
    })
  })
  return { seen, hidden: () => hidden! }
}

test('a lost reply after the reception was created is retried with the same request id', async ({
  page,
}) => {
  const { f, assistanceCalls } = await openQuick(
    page,
    `quick-photo-create-${randomUUID()}@example.test`,
  )
  try {
    const lost = await hideOnce(
      page,
      '**/api/intake',
      (body) => body?.action === 'createReception',
    )
    await choosePhoto(page, await png())
    await expectUnresolved(page)
    expect(lost.hidden().status).toBe(200)
    await retryUntilSaved(page)
    expect(lost.seen).toHaveLength(2)
    expect(lost.seen[1].body).toEqual(lost.seen[0].body)
    const createId = lost.seen[0].body!.requestId as string
    expect((lost.hidden().body as { id: string }).id).toBe(createId)
    await expectOnePhoto(f, createId)
    expect(assistanceCalls()).toBe(0)
  } finally {
    await f.close()
  }
})

test('a lost reply after the upload is retried with the same photo id and no extra object', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-upload-${randomUUID()}@example.test`,
  )
  try {
    const lost = await hideOnce(page, '**/api/reception/*/photo**', () => true)
    await choosePhoto(page, await png())
    await expectUnresolved(page)
    expect(lost.hidden().status).toBe(200)
    await retryUntilSaved(page)
    expect(lost.seen).toHaveLength(2)
    expect(lost.seen[1].url).toBe(lost.seen[0].url)
    const { photoId } = await expectOnePhoto(f)
    expect(lost.seen[0].url).toContain(`photo=${photoId}`)
    expect((lost.hidden().body as { source: { id: string } }).source.id).toBe(
      photoId,
    )
  } finally {
    await f.close()
  }
})

test('a lost reply after the source save is replayed and the item keeps its photo', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-save-${randomUUID()}@example.test`,
  )
  try {
    const lost = await hideOnce(
      page,
      '**/api/intake',
      (body) => body?.action === 'saveReceptionSources',
    )
    await choosePhoto(page, await png())
    await expectUnresolved(page)
    expect(lost.hidden().status).toBe(200)
    await retryUntilSaved(page)
    expect(lost.seen).toHaveLength(2)
    expect(lost.seen[1].body).toEqual(lost.seen[0].body)
    expect((lost.hidden().body as { id: string }).id).toBe(
      lost.seen[0].body!.requestId,
    )
    const { session } = await expectOnePhoto(f)
    // The item made from this reception carries the photo.
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic photographed hat')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('70')
    await panel(page).submit.click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(/I-[0-9A-F]{8}/)
    expect(
      (
        await f.db.query(
          "select origin_id, (select detail->>'photo' from access_events a where a.tenant_id=i.tenant_id and a.action='item.quick_received' and a.target_id=i.id) photo from items i where tenant_id=$1",
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ origin_id: session, photo: 'true' }])
  } finally {
    await f.close()
  }
})

test('a damaged success reply keeps the phase unresolved until it is confirmed', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-body-${randomUUID()}@example.test`,
  )
  try {
    // The save commits but its 200 body is cut off: not a confirmation.
    const seen: Record<string, unknown>[] = []
    let firstStatus = 0
    await page.route('**/api/intake', async (route) => {
      const body = route.request().postDataJSON()
      if (body?.action !== 'saveReceptionSources') return route.continue()
      seen.push(body)
      if (seen.length !== 1) return route.continue()
      const response = await route.fetch()
      firstStatus = response.status()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: (await response.text()).slice(0, 9),
      })
    })
    await choosePhoto(page, await png())
    await expectUnresolved(page)
    expect(firstStatus).toBe(200)
    await retryUntilSaved(page)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(seen[0])
    await expectOnePhoto(f)
  } finally {
    await f.close()
  }
})

test('a refusal after a lost upload does not release the photo', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-history-${randomUUID()}@example.test`,
  )
  try {
    // Upload commits, reply lost; the retry's upload is answered with a
    // synthetic invalid-image refusal; the third upload really replays.
    const urls: string[] = []
    let hidden: { source: { id: string } } | undefined
    await page.route('**/api/reception/*/photo**', async (route) => {
      urls.push(route.request().url())
      if (urls.length === 1) {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        hidden = await response.json()
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'REQUEST_FAILED' }),
        })
      }
      if (urls.length === 2)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'INVALID_IMAGE' }),
        })
      return route.continue()
    })
    await choosePhoto(page, await png())
    await expectUnresolved(page)
    await panel(page).retry.click()
    await expectUnresolved(page)
    await expect(panel(page).alert).toContainText(
      d.quickIntake.errors.INVALID_IMAGE,
    )
    await retryUntilSaved(page)
    expect(urls).toHaveLength(3)
    expect(new Set(urls).size).toBe(1)
    const { photoId } = await expectOnePhoto(f)
    expect(hidden!.source.id).toBe(photoId)
  } finally {
    await f.close()
  }
})

test('a first invalid file is replaced on the same reception', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-invalid-${randomUUID()}@example.test`,
  )
  try {
    const creates: Record<string, unknown>[] = []
    await page.route('**/api/intake', async (route) => {
      const body = route.request().postDataJSON()
      if (body?.action === 'createReception') creates.push(body)
      return route.continue()
    })
    const refused = page.waitForResponse(
      (r) => r.url().includes('/photo?') && r.status() === 400,
    )
    await choosePhoto(page, Buffer.from('not an image at all'), 'note.png')
    expect(((await (await refused).json()) as { error: string }).error).toBe(
      'INVALID_IMAGE',
    )
    const p = panel(page)
    await expect(p.alert).toHaveText(d.quickIntake.errors.INVALID_IMAGE)
    await expect(p.preview).toHaveCount(0)
    await expect(p.input).toBeEnabled()
    await expect(p.submit).toBeEnabled()
    await expect(p.retry).toHaveCount(0)
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'saveReceptionSources' &&
        r.status() === 200,
    )
    await choosePhoto(page, await png())
    await saved
    await expect(p.alert).toHaveCount(0)
    await expect(p.preview).toBeVisible()
    // The reception created for the refused file is the one the good file uses.
    expect(creates).toHaveLength(1)
    await expectOnePhoto(f, creates[0].requestId as string)
  } finally {
    await f.close()
  }
})

test('a lost create followed by a real invalid file is correctable once the create is confirmed', async ({
  page,
}) => {
  const { f } = await openQuick(
    page,
    `quick-photo-create-invalid-${randomUUID()}@example.test`,
  )
  try {
    const lost = await hideOnce(
      page,
      '**/api/intake',
      (body) => body?.action === 'createReception',
    )
    // Not an image: the create commits (reply lost), the upload never runs.
    await choosePhoto(page, Buffer.from('not an image at all'), 'note.png')
    await expectUnresolved(page)
    // Retry: the create replays with its exact id and is confirmed, then the
    // upload route refuses the bytes for the first time. That settles the
    // create, so the file is released for correction on the same reception.
    const refused = page.waitForResponse(
      (r) => r.url().includes('/photo?') && r.status() === 400,
    )
    await panel(page).retry.click()
    expect(((await (await refused).json()) as { error: string }).error).toBe(
      'INVALID_IMAGE',
    )
    const p = panel(page)
    await expect(p.alert).toHaveText(d.quickIntake.errors.INVALID_IMAGE)
    await expect(p.preview).toHaveCount(0)
    await expect(p.input).toBeEnabled()
    await expect(p.submit).toBeEnabled()
    await expect(p.retry).toHaveCount(0)
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/intake') &&
        r.request().postDataJSON()?.action === 'saveReceptionSources' &&
        r.status() === 200,
    )
    await choosePhoto(page, await png())
    await saved
    await expect(p.alert).toHaveCount(0)
    await expect(p.preview).toBeVisible()
    expect(lost.seen).toHaveLength(2)
    expect(lost.seen[1].body).toEqual(lost.seen[0].body)
    await expectOnePhoto(f, lost.seen[0].body!.requestId as string)
  } finally {
    await f.close()
  }
})
