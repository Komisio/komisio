import { test, expect, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

async function expectCompactCheckbox(checkbox: Locator) {
  await expect(checkbox).toBeVisible()
  const geometry = await checkbox.evaluate((element: HTMLInputElement) => {
    const label = element.labels![0]
    const text = [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    )!
    const range = document.createRange()
    range.selectNodeContents(text)
    const textBox = range.getBoundingClientRect()
    const inputBox = element.getBoundingClientRect()
    const labelBox = label.getBoundingClientRect()
    return {
      width: inputBox.width,
      height: inputBox.height,
      targetHeight: labelBox.height,
      leftInset: inputBox.left - labelBox.left,
      textGap: textBox.left - inputBox.right,
      centerDifference: Math.abs(
        inputBox.top + inputBox.height / 2 - textBox.top - textBox.height / 2,
      ),
    }
  })
  expect(geometry.width).toBe(18)
  expect(geometry.height).toBe(18)
  expect(geometry.targetHeight).toBeGreaterThanOrEqual(44)
  expect(geometry.leftInset).toBe(0)
  expect(geometry.textGap).toBeGreaterThanOrEqual(8)
  expect(geometry.centerDifference).toBeLessThanOrEqual(2)
}

test('settings checkboxes stay compact and aligned on desktop and phones', async ({
  page,
}, testInfo) => {
  const email = `checkboxes-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.goto('/settings?tab=vocabulary')
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expectCompactCheckbox(
        page.getByLabel(d.registration.descriptionRequired, { exact: true }),
      )
      await page
        .getByRole('button', { name: d.quickIntake.createType, exact: true })
        .click()
      const create = page.getByRole('group', {
        name: d.quickIntake.createType,
        exact: true,
      })
      const createInherit = create.getByLabel(
        d.vocabularySettings.inheritDefaults,
        { exact: true },
      )
      await expect(createInherit).toBeChecked()
      await expectCompactCheckbox(createInherit)
      await expect(create.locator('.vocabulary-field-choices')).toHaveCount(0)
      await createInherit.uncheck()
      await expectCompactCheckbox(create.getByLabel('Märke', { exact: true }))
      await expect(create.getByLabel('Märke', { exact: true })).toBeEnabled()
      await create.screenshot({
        path: testInfo.outputPath(`create-checkbox-${width}.png`),
      })
      await createInherit.check()
      await expect(create.locator('.vocabulary-field-choices')).toHaveCount(0)
      await create
        .getByRole('button', { name: d.quickIntake.typeCancel })
        .click()

      await page
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: /Jacka/ }) })
        .getByRole('button', { name: d.catalogueEditing.edit, exact: true })
        .click()
      const edit = page.getByRole('form', { name: 'Redigera: Jacka' })
      const editInherit = edit.getByLabel(
        d.vocabularySettings.inheritDefaults,
        { exact: true },
      )
      await expect(editInherit).toBeChecked()
      await expectCompactCheckbox(editInherit)
      const brand = edit.getByLabel('Märke', { exact: true })
      await expectCompactCheckbox(brand)
      await expect(brand).toBeDisabled()
      await editInherit.uncheck()
      await expect(brand).toBeEnabled()
      await expectCompactCheckbox(editInherit)
      await edit.screenshot({
        path: testInfo.outputPath(`edit-checkbox-${width}.png`),
      })
      await editInherit.check()
      await expect(brand).toBeDisabled()
      await edit.getByRole('button', { name: d.quickIntake.typeCancel }).click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  } finally {
    await f.close()
  }
})
