import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const mode of ['quick', 'bag', 'stepwise'] as const) {
  test(`${mode}: create a store type inline without losing item input`, async ({
    page,
  }, info) => {
    const email = `inline-type-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const id = randomUUID()
      if (mode === 'stepwise')
        await f.db.query('select create_reception_session($1,$2,$3)', [
          f.tenant,
          id,
          f.seller,
        ])
      else
        await f.db.query("select receive_bag_with_agreement($1,$2,$3,'',$4)", [
          f.tenant,
          id,
          f.seller,
          f.agreement,
        ])
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(
        mode === 'quick'
          ? '/intake/quick'
          : mode === 'bag'
            ? `/intake/bags/${id}/inspect`
            : `/intake/reception/${id}`,
      )
      if (mode === 'quick')
        await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
      const stepwise = mode === 'stepwise'
      const description = page.locator(
        stepwise ? '#garment-description' : '#quick-description',
      )
      const price = page.locator(stepwise ? '#garment-price' : '#quick-price')
      const type = page.locator(stepwise ? '#garment-type' : '#quick-item-type')
      await type.selectOption('jacket')
      await description.fill('Synthetic retained item')
      await price.fill('125')
      if (!stepwise) await page.getByLabel('Storlek', { exact: true }).fill('M')
      let photoSource: string | null = null
      if (mode === 'quick') {
        const buffer = await sharp({
          create: {
            width: 120,
            height: 120,
            channels: 3,
            background: '#335577',
          },
        })
          .png()
          .toBuffer()
        await page.locator('#quick-photo').setInputFiles({
          name: 'synthetic.png',
          mimeType: 'image/png',
          buffer,
        })
        await expect(type).toBeEnabled()
        photoSource = await page
          .locator('.quick-photo-picker img')
          .getAttribute('src')
      }
      if (stepwise) {
        await page.locator('#garment-reference').fill('Synthetic evidence')
        await page.locator('#garment-rationale').fill('Synthetic appraisal')
      }
      const submit = page.getByRole('button', {
        name: stepwise
          ? d.reception.saveSources
          : mode === 'quick'
            ? d.quickIntake.submit
            : d.bagIntake.save,
        exact: true,
      })
      await type.selectOption('__create__')
      const editor = page.getByRole('group', {
        name: d.quickIntake.createType,
        exact: true,
      })
      await expect(submit).toBeDisabled()
      await expect(editor.getByRole('checkbox')).toHaveCount(0)
      await editor
        .getByRole('button', { name: d.quickIntake.typeCancel, exact: true })
        .click()
      await expect(type).toBeFocused()
      await expect(description).toHaveValue('Synthetic retained item')
      await type.selectOption('__create__')
      const name = page.getByLabel(d.quickIntake.typeName, { exact: true })
      await name.fill('Jacket')
      await name.press('Enter')
      await expect(editor.getByRole('alert')).toHaveText(
        d.quickIntake.typeNameExists,
      )
      await expect(name).toBeEnabled()
      const title = `Synthetic inline ${mode}`
      await name.fill(title)
      await expect(editor.getByRole('alert')).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await editor.screenshot({
        path: info.outputPath(`${mode}-create-type-editor.png`),
      })
      const requests: unknown[] = []
      if (mode === 'quick')
        await page.route('**/api/item-types', async (route) => {
          requests.push(route.request().postDataJSON())
          const response = await route.fetch()
          if (requests.length === 1)
            return route.fulfill({
              status: 503,
              json: { error: 'REQUEST_FAILED' },
            })
          return route.fulfill({ response })
        })
      await name.press('Enter')
      if (mode === 'quick') {
        await expect(editor.getByRole('alert')).toHaveText(
          d.vocabularySettings.uncertain,
        )
        await expect(name).toBeDisabled()
        await expect(submit).toBeDisabled()
        await editor
          .getByRole('button', { name: d.quickIntake.typeRetry, exact: true })
          .click()
        expect(requests[1]).toEqual(requests[0])
      }
      await expect(editor).toHaveCount(0)
      await expect(type).toBeFocused()
      const slug = await type.inputValue()
      expect(slug).toMatch(/^custom_/)
      await expect(type.locator('option:checked')).toHaveText(title)
      await expect(description).toHaveValue('Synthetic retained item')
      await expect(price).toHaveValue('125')
      if (!stepwise)
        await expect(page.getByLabel('Storlek', { exact: true })).toHaveValue(
          'M',
        )
      if (photoSource)
        await expect(page.locator('.quick-photo-picker img')).toHaveAttribute(
          'src',
          photoSource,
        )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: info.outputPath(`${mode}-inline-type.png`),
        fullPage: true,
      })
      await submit.click()
      if (stepwise)
        await expect(page.locator('.reception-step').nth(1)).toContainText(
          title,
        )
      else {
        await expect(page.locator('.quick-done')).toBeVisible()
        await page
          .getByRole('button', {
            name: mode === 'quick' ? d.quickIntake.next : d.bagIntake.next,
            exact: true,
          })
          .click()
        await expect(type.locator(`option[value="${slug}"]`)).toHaveText(title)
      }
      page.on('dialog', (dialog) => dialog.accept())
      await page.goto('/settings?tab=vocabulary')
      await expect(
        page.getByRole('row', { name: new RegExp(title) }),
      ).toBeVisible()
    } finally {
      await f.close()
    }
  })
}
