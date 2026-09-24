import { test, expect } from '@playwright/test'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('store instructions persist, retain edits across steps and reject a stale editor', async ({
  page,
}, testInfo) => {
  const email = `flow-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/intake/flow')
    await expect(
      page.getByRole('heading', { name: d.storeFlow.title, exact: true }),
    ).toBeVisible()
    const second = await page.context().newPage()
    await second.goto('/intake/flow')
    await page
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Synthetic shelf B')
    await page
      .getByRole('button', { name: new RegExp(d.storeFlow.steps.wait.title) })
      .click()
    await page
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Synthetic morning inspection')
    await page
      .getByRole('button', { name: d.storeFlow.save, exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(d.storeFlow.saved)
    await page.reload()
    await expect(
      page.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Synthetic shelf B')
    await second
      .getByLabel(d.storeFlow.localRoutine, { exact: true })
      .fill('Stale text')
    await second
      .getByRole('button', { name: d.storeFlow.save, exact: true })
      .click()
    await expect(second.getByRole('status')).toHaveText(d.storeFlow.conflict)
    await expect(
      second.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Stale text')
    await second.close()
    await page.screenshot({
      path: testInfo.outputPath('flow-desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: new RegExp(d.storeFlow.steps.wait.title) })
      .click()
    await expect(page.locator('#flow-detail')).toBeFocused()
    await expect(
      page.getByLabel(d.storeFlow.localRoutine, { exact: true }),
    ).toHaveValue('Synthetic morning inspection')
    await page.getByRole('link', { name: `↑ ${d.storeFlow.title}` }).click()
    await page
      .getByRole('button', {
        name: new RegExp(d.storeFlow.steps.receive.title),
      })
      .click()
    await expect(
      page.getByRole('link', {
        name: d.storeFlow.steps.receive.action,
        exact: true,
      }),
    ).toHaveAttribute('href', '/intake')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('flow-mobile.png'),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})
