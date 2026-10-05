import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('task queue starts with actionable work and keeps concise help on demand', async ({
  page,
}) => {
  const email = `operations-layout-${randomUUID()}@example.test`
  await register(page, email, `Test!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/operations')
    await expect(
      page.getByRole('heading', { name: d.operations.emptyOpenTitle }),
    ).toBeVisible()
    const filters = page.getByRole('navigation', {
      name: d.operations.queueFilter,
    })
    await expect(filters.locator('[aria-current="page"]')).toHaveAttribute(
      'href',
      '/intake/operations?status=open',
    )
    const help = page.getByRole('button', {
      name: d.operations.queueHelp.label,
    })
    await expect(
      page.getByText(d.operations.queueHelp.steps[0], { exact: true }),
    ).toBeHidden()
    await help.focus()
    await page.keyboard.press('Enter')
    await expect(help).toHaveAttribute('aria-expanded', 'true')
    await expect(
      page.getByText(d.operations.queueHelp.steps[0], { exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(help).toHaveAttribute('aria-expanded', 'false')
    await filters
      .getByRole('link', { name: d.operations.queueLabels.failed, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.operations.emptyFiltered }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: d.operations.emptyOpenTitle }),
    ).toHaveCount(0)
    await page
      .getByRole('link', { name: d.operations.filterAll, exact: true })
      .click()
    await expect(page).toHaveURL(/status=all$/)
    await expect(filters.locator('[aria-current="page"]')).toHaveText(
      d.operations.queueLabels.all,
    )
    await page.setViewportSize({ width: 320, height: 720 })
    await help.click()
    await expect(
      page.getByText(d.operations.queueHelp.steps[2], { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})
