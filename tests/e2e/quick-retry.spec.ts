import { test, expect, type Page } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

type Saved = { itemId: string; reference: string; sessionId: string }

/**
 * Lets the first quick-reception request reach the server and commit, then
 * hides its reply behind a 503: the browser cannot know whether the item was
 * received. Every later request passes through untouched.
 */
async function loseFirstReply(page: Page) {
  const requests: Record<string, unknown>[] = []
  let saved: Saved | undefined
  let firstStatus = 0
  await page.route('**/api/intake/quick', async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length !== 1) return route.continue()
    const response = await route.fetch()
    firstStatus = response.status()
    saved = await response.json()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'REQUEST_FAILED' }),
    })
  })
  return {
    requests,
    saved: () => saved!,
    firstStatus: () => firstStatus,
  }
}

test('retrying a lost quick-reception response does not register another item', async ({
  page,
}) => {
  const email = `quick-retry-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    await description.fill('Synthetic retry chair')
    await price.fill('250')
    const lost = await loseFirstReply(page)
    const submit = page.locator('.quick-finish').getByRole('button')
    await price.press('Enter')
    const alert = page.locator('.quick-item').getByRole('alert')
    await expect(alert).toHaveText(d.quickIntake.uncertain)
    expect(lost.firstStatus()).toBe(200)
    // The attempt is frozen: nothing on screen may suggest edits would apply,
    // and the only ways forward are the same retry or a reload.
    for (const control of [
      description,
      price,
      page.getByLabel(d.quickIntake.itemType, { exact: true }),
      page.locator('#quick-photo'),
      page.getByRole('button', {
        name: d.quickIntake.changeSeller,
        exact: true,
      }),
    ])
      await expect(control).toBeDisabled()
    await expect(submit).toHaveText(d.quickIntake.retry)
    await expect(submit).toBeEnabled()
    await expect(
      page
        .locator('.quick-item')
        .getByRole('button', { name: d.quickIntake.reload, exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await submit.focus()
    await submit.press('Enter')
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done).toBeVisible()
    const saved = lost.saved()
    await expect(done).toContainText(saved.reference)
    expect(lost.requests).toHaveLength(2)
    expect(lost.requests[1]).toEqual(lost.requests[0])
    expect(lost.requests[0].sessionId).toBeNull()
    const items = (
      await f.db.query('select id,origin_id from items where tenant_id=$1', [
        f.tenant,
      ])
    ).rows
    expect(items).toEqual([{ id: saved.itemId, origin_id: saved.sessionId }])
    for (const [table, expected] of [
      ['reception_sessions', 1],
      ['garment_receipts', 1],
      ['reception_reviews', 1],
    ] as const)
      expect(
        (
          await f.db.query(
            `select count(*)::int n from ${table} where tenant_id=$1`,
            [f.tenant],
          )
        ).rows[0].n,
        table,
      ).toBe(expected)
    expect(
      (
        await f.db.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='item.quick_received'",
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
    // Next item starts a new attempt with its own request id and item.
    await page
      .getByRole('button', { name: d.quickIntake.next, exact: true })
      .click()
    await expect(description).toBeEnabled()
    await description.fill('Synthetic retry stool')
    await price.fill('90')
    await expect(submit).toHaveText(d.quickIntake.submit)
    await submit.click()
    await expect(done).toBeVisible()
    await expect(done).not.toContainText(saved.reference)
    expect(lost.requests).toHaveLength(3)
    expect(lost.requests[2].requestId).not.toBe(lost.requests[0].requestId)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(2)
  } finally {
    await f.close()
  }
})

test('a refusal after a lost reply does not unfreeze the attempt', async ({
  page,
}) => {
  const email = `quick-retry-history-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic history bench')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('300')
    // First request commits but its reply is lost; the second is refused with
    // a known 4xx without reaching the engine; the third really replays.
    const requests: Record<string, unknown>[] = []
    let saved: Saved | undefined
    await page.route('**/api/intake/quick', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        saved = await response.json()
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'REQUEST_FAILED' }),
        })
      }
      if (requests.length === 2)
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'INVALID_INPUT' }),
        })
      return route.continue()
    })
    const submit = page.locator('.quick-finish').getByRole('button')
    const alert = page.locator('.quick-item').getByRole('alert')
    await submit.click()
    await expect(alert).toHaveText(d.quickIntake.uncertain)
    await submit.click()
    // The refusal is detail; the first outcome is still unknown, so the
    // fields stay frozen and the same command is what the next click sends.
    await expect(alert).toContainText(d.quickIntake.uncertain)
    await expect(alert).toContainText(d.quickIntake.errors.INVALID_INPUT)
    await expect(description).toBeDisabled()
    await expect(submit).toHaveText(d.quickIntake.retry)
    await submit.click()
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done).toContainText(saved!.reference)
    expect(requests).toHaveLength(3)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[2]).toEqual(requests[0])
    expect(
      (await f.db.query('select id from items where tenant_id=$1', [f.tenant]))
        .rows,
    ).toEqual([{ id: saved!.itemId }])
  } finally {
    await f.close()
  }
})

test('a damaged success reply keeps the attempt frozen until the item is confirmed', async ({
  page,
}) => {
  const email = `quick-retry-body-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic truncated vase')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('45')
    // The first reply is a 200 whose body is cut off: not a confirmation.
    const requests: Record<string, unknown>[] = []
    let saved: Saved | undefined
    await page.route('**/api/intake/quick', async (route) => {
      requests.push(route.request().postDataJSON())
      if (requests.length !== 1) return route.continue()
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      saved = await response.json()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(saved).slice(0, 12),
      })
    })
    const submit = page.locator('.quick-finish').getByRole('button')
    await submit.click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.uncertain,
    )
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toHaveCount(0)
    await expect(submit).toHaveText(d.quickIntake.retry)
    await submit.click()
    await expect(
      page.getByRole('region', { name: d.quickIntake.done, exact: true }),
    ).toContainText(saved!.reference)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(
      (await f.db.query('select id from items where tenant_id=$1', [f.tenant]))
        .rows,
    ).toEqual([{ id: saved!.itemId }])
  } finally {
    await f.close()
  }
})

test('a stale-picture refusal offers a reload while the fields stay editable', async ({
  page,
}) => {
  const email = `quick-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic stale mirror')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('80')
    // The engine's "changed in another window" refusal, answered without any
    // write: resending the same fields would only repeat it.
    let requests = 0
    await page.route('**/api/intake/quick', async (route) => {
      requests += 1
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'RECEPTION_CHANGED' }),
      })
    })
    const submit = page.locator('.quick-finish').getByRole('button')
    await submit.click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.errors.RECEPTION_CHANGED,
    )
    await expect(description).toBeEnabled()
    await expect(submit).toHaveText(d.quickIntake.submit)
    const reload = page
      .locator('.quick-item')
      .getByRole('button', { name: d.quickIntake.reload, exact: true })
    await expect(reload).toBeVisible()
    await reload.click()
    // A fresh page: the seller is chosen again and nothing was written.
    await expect(
      page.getByLabel(d.quickIntake.searchSeller, { exact: true }),
    ).toBeVisible()
    expect(requests).toBe(1)
    expect(
      (
        await f.db.query(
          'select count(*)::int n from items where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})

test('a known refusal leaves the fields correctable under the same request id', async ({
  page,
}) => {
  const email = `quick-refusal-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 720 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    await description.fill('Synthetic refused lamp')
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    // 1 000 000 in the store currency is 100 000 000 minor units, above the
    // deployed validator's maximum: the route itself answers 400 before the
    // engine runs, so nothing is stored and the same id may carry a
    // corrected command.
    await price.fill('1000000')
    const requests: Record<string, unknown>[] = []
    const statuses: number[] = []
    await page.route('**/api/intake/quick', async (route) => {
      requests.push(route.request().postDataJSON())
      const response = await route.fetch()
      statuses.push(response.status())
      await route.fulfill({ response })
    })
    const submit = page.locator('.quick-finish').getByRole('button')
    await submit.click()
    await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
      d.quickIntake.errors.INVALID_INPUT,
    )
    expect(statuses).toEqual([400])
    await expect(description).toBeEnabled()
    await expect(price).toBeEnabled()
    await expect(submit).toHaveText(d.quickIntake.submit)
    await expect(
      page
        .locator('.quick-item')
        .getByRole('button', { name: d.quickIntake.reload, exact: true }),
    ).toHaveCount(0)
    await description.fill('Synthetic corrected lamp')
    await price.fill('120')
    await submit.click()
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    await expect(done).toContainText('Synthetic corrected lamp')
    expect(statuses).toEqual([400, 200])
    expect(requests).toHaveLength(2)
    expect(requests[1].requestId).toBe(requests[0].requestId)
    expect(requests[0].priceOre).toBe(100_000_000)
    expect(requests[1].priceOre).toBe(12_000)
    expect((requests[1].facts as { description: string }).description).toBe(
      'Synthetic corrected lamp',
    )
    for (const table of ['items', 'reception_sessions'] as const)
      expect(
        (
          await f.db.query(
            `select count(*)::int n from ${table} where tenant_id=$1`,
            [f.tenant],
          )
        ).rows[0].n,
        table,
      ).toBe(1)
  } finally {
    await f.close()
  }
})

for (const withPhoto of [false, true])
  test(`a lost reply inside a bag reception replays the same item (photo: ${withPhoto})`, async ({
    page,
  }) => {
    const email = `quick-bag-retry-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      const bag = (
        await f.db.query(
          'select receive_bag_with_agreement($1,$2,$3,$4,$5) id',
          [f.tenant, randomUUID(), f.seller, '', f.agreement],
        )
      ).rows[0].id
      await f.commit()
      await page.setViewportSize({ width: 320, height: 720 })
      await page.goto(`/intake/bags/${bag}/inspect`)
      let assistanceCalls = 0
      await page.route('**/api/reception/assistance', (route) => {
        assistanceCalls++
        return route.abort()
      })
      if (withPhoto) {
        const bytes = await sharp({
          create: { width: 8, height: 8, channels: 3, background: '#346789' },
        })
          .png()
          .toBuffer()
        const sourceSaved = page.waitForResponse(
          (r) =>
            r.url().endsWith('/api/intake') &&
            r.request().postDataJSON()?.action === 'saveReceptionSources',
        )
        // Enabled only once React handles the input; a file chosen before
        // hydration would be lost.
        await expect(page.locator('#quick-photo')).toBeEnabled()
        await page.locator('#quick-photo').setInputFiles({
          name: 'synthetic-retry.png',
          mimeType: 'image/png',
          buffer: bytes,
        })
        expect((await sourceSaved).status()).toBe(200)
        await expect(
          page.locator('.quick-finish').getByRole('button'),
        ).toBeEnabled()
      }
      await page
        .getByLabel(d.quickIntake.description, { exact: true })
        .fill('Synthetic bag retry scarf')
      await page.getByLabel(d.quickIntake.price, { exact: true }).fill('60')
      const lost = await loseFirstReply(page)
      const submit = page.locator('.quick-finish').getByRole('button')
      await submit.click()
      await expect(page.locator('.quick-item').getByRole('alert')).toHaveText(
        d.quickIntake.uncertain,
      )
      expect(lost.firstStatus()).toBe(200)
      await expect(submit).toHaveText(d.quickIntake.retry)
      await submit.click()
      const done = page.getByRole('region', {
        name: d.quickIntake.done,
        exact: true,
      })
      await expect(done).toContainText(lost.saved().reference)
      expect(lost.requests).toHaveLength(2)
      expect(lost.requests[1]).toEqual(lost.requests[0])
      expect(lost.requests[0].bagId).toBe(bag)
      expect(assistanceCalls).toBe(0)
      if (withPhoto) {
        expect(lost.requests[0].sessionId).toBe(lost.saved().sessionId)
        expect(lost.requests[0].expectedRevision).toBe(1)
        const sources = (
          await f.db.query(
            'select sources from reception_source_revisions where tenant_id=$1 and session_id=$2 order by revision desc limit 1',
            [f.tenant, lost.saved().sessionId],
          )
        ).rows[0].sources as { kind: string }[]
        expect(
          sources.filter((source) => source.kind === 'photo'),
        ).toHaveLength(1)
        await expect(page.locator('.bag-received-items img')).toHaveCount(1)
      } else expect(lost.requests[0].sessionId).toBeNull()
      expect(
        (
          await f.db.query(
            'select id, origin_id from items where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([
        { id: lost.saved().itemId, origin_id: lost.saved().sessionId },
      ])
      expect(
        (
          await f.db.query(
            'select bag_id from reception_sessions where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([{ bag_id: bag }])
    } finally {
      await f.close()
    }
  })
