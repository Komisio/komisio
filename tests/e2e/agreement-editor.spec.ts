import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('agreement workspace keeps a compact editor, preserves drafts and fits all interface languages', async ({
  page,
}) => {
  const email = `agreement-editor-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/intake/agreements#agreements-publish')
    const publisher = page.getByTestId('agreement-publisher')
    const generate = publisher.getByRole('button', {
      name: d.agreements.ai.create,
      exact: true,
    })
    await expect(generate).toBeVisible()
    await expect(publisher.getByRole('heading')).toHaveCount(0)
    await expect(publisher.getByRole('region')).toHaveCount(0)
    await expect(publisher.locator('details')).toHaveCount(0)
    await expect(
      publisher.getByText(d.agreements.editor.newVersionHint),
    ).toHaveCount(0)
    for (const text of [
      d.agreements.ai.use,
      d.agreements.ai.close,
      d.agreements.ai.questions,
      d.agreements.ai.replace,
    ]) {
      await expect(publisher.getByText(text, { exact: true })).toHaveCount(0)
    }
    expect((await generate.boundingBox())!.y).toBeLessThan(
      (await page.locator('#agreement-title').boundingBox())!.y,
    )
    await page.locator('#agreement-title').fill('Villkor för inlämning')
    await page
      .locator('#agreement-body')
      .fill(
        'Testvillkor för butiken.\n\nPriser och försäljningsperiod beslutas vid inlämningen.\n<b>Detta är vanlig text.</b>',
      )
    await page.locator('#agreement-language').selectOption('sv')
    await page.screenshot({
      path: 'private/agreement-editor-desktop.png',
      fullPage: true,
    })
    await page
      .getByRole('tab', { name: d.agreements.workspace.versions, exact: true })
      .click()
    await page
      .getByRole('link', {
        name: d.agreements.workspace.manageLanguages,
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('tab', {
        name: d.agreements.workspace.languages,
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.agreement-language-list tbody tr')).toHaveCount(
      1,
    )
    await page
      .getByRole('tab', { name: d.agreements.workspace.publish, exact: true })
      .click()
    await expect(page.locator('#agreement-title')).toHaveValue(
      'Villkor för inlämning',
    )
    await expect(page.locator('#agreement-body')).toHaveValue(
      /<b>Detta är vanlig text.<\/b>/,
    )
    await page.setViewportSize({ width: 320, height: 740 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true)
    await page.screenshot({
      path: 'private/agreement-editor-mobile.png',
      fullPage: true,
    })
    // Restoring the original values removes the leave warning, without saving.
    // Use the actual fixture baseline rather than assuming its title.
    const original = (
      await f.db.query(
        'select title,body,language from seller_agreement_versions where id=$1',
        [f.agreement],
      )
    ).rows[0]
    await page.locator('#agreement-title').fill(original.title)
    await page.locator('#agreement-body').fill(original.body)
    await page.locator('#agreement-language').selectOption(original.language)
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const words = JSON.parse(
        await readFile(
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
      await page.goto('/intake/agreements#agreements-publish')
      await page.reload()
      await expect(
        publisher.getByRole('button', {
          name: words.agreements.ai.create,
        }),
      ).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true)
      await page
        .getByRole('tab', {
          name: words.agreements.workspace.languages,
          exact: true,
        })
        .click()
      await page
        .getByRole('link', {
          name: words.agreements.translations.add,
          exact: true,
        })
        .click()
      await expect(page.locator('#translation-body')).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true)
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_versions where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
