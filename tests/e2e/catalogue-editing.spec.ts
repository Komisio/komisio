import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('catalogue editing follows existing items and retains inactive choices', async ({
  page,
}, testInfo) => {
  const email = `catalogue-edit-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const category = randomUUID()
    await f.db.query('select create_item_category($1,$2,$3,$4)', [
      f.tenant,
      category,
      'Jackets',
      { en: 'Jackets', sv: 'Jackor' },
    ])
    const item = await f.item('Synthetic catalogue jacket')
    const slug = (
      await f.db.query('select create_item_type($1,$2,$3,$4,$5)', [
        f.tenant,
        randomUUID(),
        'Synthetic type',
        'sv',
        JSON.stringify([{ slug: 'description', expected: true, sort: 0 }]),
      ])
    ).rows[0].create_item_type
    // Historical settings can contain duplicate translations. Changing the
    // Swedish name must not require renaming every other language first.
    for (const typeSlug of [slug, 'legacy_duplicate']) {
      await f.db.query('select set_item_type($1,$2,$3)', [
        f.tenant,
        typeSlug,
        {
          labels: { sv: 'Synthetic type', en: 'Legacy duplicate' },
          active: true,
          attributes: [{ slug: 'description', expected: true, sort: 0 }],
        },
      ])
    }
    await f.db.query('select classify_items($1,$2,$3,$4,null)', [
      f.tenant,
      randomUUID(),
      JSON.stringify([{ id: item, version: 0 }]),
      slug,
    ])
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-categories')
    const row = page.getByRole('row').filter({
      has: page.getByRole('rowheader', { name: 'Jackor', exact: true }),
    })
    await row
      .getByRole('button', { name: d.catalogueEditing.edit, exact: true })
      .click()
    const editor = page.getByRole('form', { name: 'Redigera: Jackets' })
    await editor
      .getByLabel(d.vocabularySettings.name, { exact: true })
      .fill('Ytterkläder')
    await editor
      .getByText(d.vocabularySettings.translations, { exact: true })
      .click()
    await editor.getByLabel('English', { exact: true }).fill('Outerwear')
    const attempts: unknown[] = []
    await page.route('**/api/catalogue/edit', async (route) => {
      if (attempts.length >= 2) return route.continue()
      attempts.push(route.request().postDataJSON())
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      await route.fulfill(
        attempts.length === 1 ? { status: 503, json: {} } : { response },
      )
    })
    await editor.getByRole('button', { name: d.catalogueEditing.save }).click()
    await expect(editor.getByRole('alert')).toHaveText(
      d.vocabularySettings.uncertain,
    )
    await expect(
      editor.getByLabel(d.vocabularySettings.name, { exact: true }),
    ).toBeDisabled()
    await editor
      .getByRole('button', { name: d.quickIntake.typeRetry, exact: true })
      .click()
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    await expect(editor).toHaveCount(0)
    await page.goto(`/intake/items/${item}`)
    await expect(page.getByText('Ytterkläder', { exact: true })).toBeVisible()
    await page.goto('/settings?tab=vocabulary#vocabulary-types')
    // Both types intentionally look identical; the first is used by this item.
    const typeRows = page.getByRole('row').filter({
      has: page.getByRole('rowheader', { name: 'Synthetic type', exact: true }),
    })
    await expect(typeRows).toHaveCount(2)
    // Stable slug ordering places the created custom type before legacy_duplicate.
    const usedRow = typeRows.first()
    await usedRow
      .getByRole('button', {
        name: `${d.catalogueDeletion.remove}: Synthetic type`,
        exact: true,
      })
      .click()
    await usedRow
      .getByRole('button', {
        name: d.catalogueDeletion.confirmAction,
        exact: true,
      })
      .click()
    await expect(usedRow.getByRole('alert')).toContainText(
      d.catalogueDeletion.deactivateHint,
    )
    await page
      .getByRole('row')
      .filter({
        has: page.getByRole('rowheader').filter({ hasText: 'Synthetic type' }),
      })
      .first()
      .getByRole('button', { name: d.catalogueEditing.edit, exact: true })
      .click()
    const typeEditor = page.getByRole('form', {
      name: 'Redigera: Synthetic type',
    })
    await typeEditor
      .getByLabel(d.vocabularySettings.name, { exact: true })
      .fill('Edited type')
    await typeEditor
      .getByLabel(d.catalogueEditing.active, { exact: true })
      .uncheck()
    await page.setViewportSize({ width: 320, height: 740 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('catalogue-editor-mobile.png'),
      fullPage: true,
    })
    await typeEditor
      .getByRole('button', { name: d.catalogueEditing.save })
      .click()
    await expect(typeEditor).toHaveCount(0)
    await page
      .getByLabel(d.catalogueEditing.showInactive, { exact: true })
      .check()
    await expect(
      page.getByRole('row').filter({ hasText: 'Edited type' }),
    ).toContainText(d.catalogueEditing.inactive)
    await page.goto(`/intake/items/${item}`)
    await expect(page.getByText('Edited type', { exact: true })).toBeVisible()
    const command = {
      kind: 'category',
      tenantId: f.tenant,
      requestId: randomUUID(),
      id: category,
      expected: 0,
      name: 'Stale',
      labels: { en: 'Stale' },
      active: true,
    }
    expect(
      (
        await page.request.post('/api/catalogue/edit', { data: command })
      ).status(),
    ).toBe(403)
    const refused = await page.request.post('/api/catalogue/edit', {
      headers: { origin: new URL(page.url()).origin },
      data: command,
    })
    expect(refused.status()).toBe(409)
    expect((await refused.json()).error).toBe('CATALOGUE_CHANGED')
  } finally {
    await f.close()
  }
})
