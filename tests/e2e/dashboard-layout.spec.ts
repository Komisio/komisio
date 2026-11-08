import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }
import de from '../../messages/de.json' with { type: 'json' }

test('minimal overview keeps zero queues and every setup step reachable by keyboard', async ({
  page,
}, testInfo) => {
  const email = `overview-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: d.home, exact: true }),
    ).toBeVisible()
    const actions = page.locator('.dashboard-actions')
    await expect(actions.getByRole('link')).toHaveCount(2)
    await expect(
      actions.getByRole('link', { name: d.dashboard.registerItems }),
    ).toHaveAttribute('href', '/intake/quick')
    await expect(
      actions.getByRole('link', { name: d.dashboard.receiveDropoff }),
    ).toHaveAttribute('href', '/intake#bag-receiving')
    await expect(
      page.getByText(d.dashboard.nothingPending, { exact: true }),
    ).toBeVisible()
    const followUps = page.locator('.dashboard-followups a')
    await expect(followUps).toHaveCount(0)
    const toggle = page.locator('.dashboard-show-all')
    await expect(toggle).toHaveText(d.dashboard.showAll)
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(followUps).toHaveCount(4)
    await expect(
      followUps.filter({ hasText: d.selfRegistration.queue }),
    ).toHaveAttribute('href', '/intake/sellers/registrations')
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(followUps).toHaveCount(0)
    const help = page.locator('.dashboard-help')
    await expect(help).not.toHaveAttribute('open')
    await help.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(help).toHaveAttribute('open', '')
    await expect(help.getByRole('progressbar')).toBeVisible()
    await expect(help.locator('.steps a')).toHaveCount(11)
    await expect(help.locator('a[href="/guide"]')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(help).not.toHaveAttribute('open')
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.dashboard')).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`overview-${width}.png`),
        fullPage: true,
      })
    }
    await actions
      .getByRole('link', { name: d.dashboard.receiveDropoff })
      .click()
    await expect(page).toHaveURL('/intake#bag-receiving')
    await page.goto('/')
    await actions.getByRole('link', { name: d.dashboard.registerItems }).click()
    await expect(page).toHaveURL('/intake/quick')
  } finally {
    await f.close()
  }
})

test('active overview shows exact figures and current-month work across locales and widths', async ({
  page,
}, testInfo) => {
  const email = `overview-active-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic overview item')
    await f.db.query(
      "select record_sale($1,$2,'manual','OVERVIEW',now(),'SEK',$3::jsonb)",
      [
        f.tenant,
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.commit()
    for (const [locale, copy] of [
      ['sv', d],
      ['en', en],
      ['de', de],
    ] as const) {
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: 'http://127.0.0.1:3000',
        },
      ])
      await page.goto('/')
      const rows = page.locator('.dashboard-followups a')
      await expect(rows).toHaveCount(1)
      await expect(rows).toContainText(
        copy.dashboard.dayPending.replace('{count}', '1'),
      )
      await expect(rows).toContainText(copy.dashboard.thisMonth)
      await expect(rows).toHaveAttribute(
        'href',
        '/intake/accounting?view=reconciliation',
      )
      if (locale === 'sv')
        await expect(page.locator('.dashboard-metric-amount')).toHaveText([
          '200,00 kr',
          '1',
          '80,00 kr',
        ])
      for (const width of [1600, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.waitForLoadState('networkidle')
        await expect(page.locator('.dashboard')).toBeVisible()
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true)
        await expect(page.locator('.dashboard-actions a')).toHaveCount(2)
        if (locale === 'sv' && [1600, 390].includes(width))
          await page.screenshot({
            path: testInfo.outputPath(`overview-active-${width}.png`),
            fullPage: true,
          })
      }
    }
    await page.locator('.dashboard-followups a').click()
    await expect(page).toHaveURL('/intake/accounting?view=reconciliation')
  } finally {
    await f.close()
  }
})
