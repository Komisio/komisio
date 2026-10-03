import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { guideCopy } from '../../lib/guide-copy'
import d from '../../messages/sv.json' with { type: 'json' }

const c = guideCopy('sv')

test('a stale store guide offers reload and shows the other saved version', async ({
  page,
}) => {
  const email = `guide-stale-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/guide')
    for (const label of [c.owned, c.clothes, c.store, c.other, c.shop]) {
      await page.getByLabel(label, { exact: true }).check()
      await page
        .getByRole('button', {
          name: label === c.shop ? `${c.summary} →` : `${c.next} →`,
          exact: true,
        })
        .click()
    }
    const id = randomUUID()
    await f.asActor(f.actor, () =>
      f.db.query('select save_store_guide($1,$2,null,$3::jsonb)', [
        f.tenant,
        id,
        JSON.stringify({
          intake: ['owned'],
          goods: ['furniture'],
          pricing: ['store'],
          period: [],
          pos: ['other'],
          channels: ['shop'],
        }),
      ]),
    )
    await page.getByRole('button', { name: c.save, exact: true }).click()
    await expect(page.locator('.store-guide').getByRole('alert')).toHaveText(
      c.conflict,
    )
    await expect(
      page.getByRole('button', { name: c.edit, exact: true }),
    ).toBeDisabled()
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload')
      await dialog.accept()
    })
    await page
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(
      page.locator('.store-guide').getByRole('status'),
    ).toContainText(c.saved)
    await expect(
      page.locator('.store-guide dd').filter({ hasText: c.furniture }),
    ).toBeVisible()
    expect(
      (
        await f.db.query(
          'select id from store_guide_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ id }])
  } finally {
    await f.close()
  }
})

for (const reply of ['lost', 'wrong-id'] as const)
  test(`store guide preserves reviewed answers after a ${reply} reply`, async ({
    page,
  }) => {
    const email = `guide-recovery-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto('/guide')
      for (const label of [c.owned, c.clothes, c.store, c.other, c.shop]) {
        await page.getByLabel(label, { exact: true }).check()
        await page
          .getByRole('button', {
            name: label === c.shop ? `${c.summary} →` : `${c.next} →`,
            exact: true,
          })
          .click()
      }
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/store-guide', async (route) => {
        requests.push(route.request().postDataJSON())
        if (requests.length !== 1) return route.continue()
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        await route.fulfill({
          status: reply === 'lost' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify(
            reply === 'lost'
              ? { error: 'REQUEST_FAILED' }
              : { id: randomUUID() },
          ),
        })
      })
      await page.getByRole('button', { name: c.save, exact: true }).click()
      await expect(page.locator('.store-guide').getByRole('alert')).toHaveText(
        d.intake.failed,
      )
      await expect(
        page.locator('.store-guide').getByRole('status'),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: c.edit, exact: true }),
      ).toBeDisabled()
      await page
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect(
        page.locator('.store-guide').getByRole('status'),
      ).toContainText(c.saved)
      expect(requests).toHaveLength(2)
      expect(requests[1]).toEqual(requests[0])
      expect(
        (
          await f.db.query(
            'select id,answers from store_guide_versions where tenant_id=$1',
            [f.tenant],
          )
        ).rows,
      ).toEqual([{ id: requests[0].requestId, answers: requests[0].answers }])
      await expect(
        page.getByRole('button', { name: c.edit, exact: true }),
      ).toBeEnabled()
    } finally {
      await f.close()
    }
  })
