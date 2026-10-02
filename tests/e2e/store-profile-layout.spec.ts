import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'
import d from '../../messages/sv.json' with { type: 'json' }

test('store hours show only included days, preserve toggled values and publish those days only', async ({
  page,
}) => {
  const email = `profile-hours-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/settings?tab=profile')
    const form = page.getByRole('region', {
      name: d.storeProfile.title,
      exact: true,
    })
    await expect(
      form.getByText(d.storeProfile.noHours, { exact: true }),
    ).toHaveCount(7)
    await expect(form.locator('#opens-mon')).not.toBeVisible()
    await expect(form.locator('#opens-mon')).toBeDisabled()
    await form.getByLabel(d.storeProfile.days.mon, { exact: true }).check()
    await form.locator('#opens-mon').fill('09:30')
    await form.locator('#closes-mon').fill('17:45')
    await form.getByLabel(d.storeProfile.days.mon, { exact: true }).uncheck()
    await expect(form.locator('#opens-mon')).not.toBeVisible()
    await form.getByLabel(d.storeProfile.days.mon, { exact: true }).check()
    await expect(form.locator('#opens-mon')).toHaveValue('09:30')
    await expect(form.locator('#closes-mon')).toHaveValue('17:45')
    await form.getByLabel(d.storeProfile.days.tue, { exact: true }).check()
    await form.locator('#opens-tue').fill('11:00')
    await form.getByLabel(d.storeProfile.days.tue, { exact: true }).uncheck()
    const reply = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/intake') &&
        response.request().postDataJSON()?.action === 'publishStoreProfile',
    )
    await form
      .getByRole('button', { name: d.storeProfile.publish, exact: true })
      .click()
    expect((await reply).status()).toBe(200)
    await page.reload()
    await expect(
      form.getByLabel(d.storeProfile.days.mon, { exact: true }),
    ).toBeChecked()
    await expect(
      form.getByLabel(d.storeProfile.days.tue, { exact: true }),
    ).not.toBeChecked()
    await expect(form.locator('#opens-mon')).toHaveValue('09:30')
    const rows = (
      await f.db.query(
        'select profile from store_profile_versions where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].profile.openingHours).toEqual([
      { day: 'mon', opens: '09:30', closes: '17:45' },
    ])
  } finally {
    await f.close()
  }
})

test('store profile sections and opening-hour controls fit all interface languages', async ({
  page,
}) => {
  const email = `profile-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
        readFileSync(
          new URL(`../../messages/${locale}.json`, import.meta.url),
          'utf8',
        ),
      )
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.goto('/settings?tab=profile')
      await page.getByLabel(d.storeProfile.days.mon, { exact: true }).check()
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.locator('#opens-mon').scrollIntoViewIfNeeded()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
        for (const id of ['opens-mon', 'closes-mon']) {
          const bounds = await page.locator(`#${id}`).boundingBox()
          expect(bounds!.width).toBeGreaterThanOrEqual(120)
          expect(bounds!.height).toBeGreaterThanOrEqual(44)
        }
        if (locale === 'sv')
          await page.screenshot({
            path: `private/profile-hours-${width}.png`,
            caret: 'initial',
          })
      }
    }
  } finally {
    await f.close()
  }
})

test('a settings bookmark for an unavailable connector tab falls back to usable settings', async ({
  page,
}) => {
  const email = `settings-tab-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=connectors')
    if (
      await page.locator('.view-tab[href="/settings?tab=connectors"]').count()
    ) {
      await expect(
        page.getByRole('region', { name: d.connectors.title, exact: true }),
      ).toBeVisible()
    } else {
      await expect(
        page.getByRole('region', { name: d.storePolicy.title, exact: true }),
      ).toBeVisible()
      await expect(
        page.locator('.view-tab[aria-current="page"]'),
      ).toHaveAttribute('href', '/settings')
    }
  } finally {
    await f.close()
  }
})
