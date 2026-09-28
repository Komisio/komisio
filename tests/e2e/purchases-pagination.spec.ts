import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '@/lib/i18n'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

// Synthetic store purchases only, through the existing engine. Pagination
// must expose older unaccepted receipts without changing acceptance rules.
test('older purchases remain reachable and can be accepted from their page', async ({
  page,
}) => {
  const email = `purchase-pages-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    for (let i = 0; i < 23; i++)
      await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
        f.tenant,
        randomUUID(),
        `Synthetic purchase ${i}`,
        10000,
        `Synthetic evidence ${i}`,
      ])
    const ordered = (
      await f.db.query(
        'select id,reference::text from purchase_receipts where tenant_id=$1 order by purchased_at desc,id',
        [f.tenant],
      )
    ).rows as { id: string; reference: string }[]
    const other = (
      await f.db.query('select create_tenant($1,$2,$3) id', [
        'Other synthetic purchase store',
        `purchase-other-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
      other,
      randomUUID(),
      'OTHER STORE PURCHASE MUST NOT APPEAR',
      10000,
      'Synthetic other evidence',
    ])
    await f.db.query('select set_active_tenant($1)', [f.tenant])
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/intake/purchases?page=2')
    const list = page.locator('.intake-list')
    const rows = list.locator(':scope > li')
    await expect(rows).toHaveCount(3)
    for (const receipt of ordered.slice(20))
      await expect(
        list.getByText(`${d.purchases.reference} P-${receipt.reference}`, {
          exact: true,
        }),
      ).toBeVisible()
    await expect(
      page.getByText('OTHER STORE PURCHASE MUST NOT APPEAR', { exact: false }),
    ).toHaveCount(0)
    const previous = page
      .getByRole('link', { name: d.sellersList.previousPage, exact: true })
      .first()
    await expect(previous).toBeVisible()
    expect((await previous.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await previous.click()
    await expect(rows).toHaveCount(20)
    for (const receipt of ordered.slice(0, 20))
      await expect(
        list.getByText(`${d.purchases.reference} P-${receipt.reference}`, {
          exact: true,
        }),
      ).toBeVisible()
    await page
      .getByRole('link', { name: d.sellersList.nextPage, exact: true })
      .first()
      .click()
    await expect(rows).toHaveCount(3)
    expect(new URL(page.url()).searchParams.get('page')).toBe('2')
    // Existing acceptance from an older receipt remains the same engine path.
    const older = ordered[20]
    const row = rows.filter({
      has: page.getByText(`${d.purchases.reference} P-${older.reference}`, {
        exact: true,
      }),
    })
    await row.getByLabel(d.items.price, { exact: true }).fill('250')
    await row.getByRole('checkbox').check()
    await row.getByRole('button', { name: d.items.accept, exact: true }).click()
    await expect(
      row.getByRole('link', { name: new RegExp(d.items.open) }),
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get('page')).toBe('2')
    const accepted = await f.db.query(
      "select id from items where tenant_id=$1 and origin_kind='purchase' and origin_id=$2",
      [f.tenant, older.id],
    )
    expect(accepted.rows).toHaveLength(1)
    await expect(row.getByRole('link')).toHaveAttribute(
      'href',
      `/intake/items/${accepted.rows[0].id}`,
    )
    // Huge but syntactically valid page is clamped before an out-of-range read.
    await page.goto('/intake/purchases?page=9999999')
    await expect(page).toHaveURL(/\/intake\/purchases\?page=2(?:#.*)?$/)
    await expect(rows).toHaveCount(3)
    for (const invalid of ['-1', '0', '1.5', 'abc', '99999999999999999999']) {
      await page.goto(`/intake/purchases?page=${invalid}`)
      await expect(rows).toHaveCount(20)
    }
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      await test.step(`mobile pager ${locale}`, async () => {
        const translated: Dictionary = JSON.parse(
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
        // A full navigation applies the changed locale cookie; a same-fragment
        // navigation can retain the previous document and language.
        await page.goto('/intake/purchases?page=2')
        await expect(rows).toHaveCount(3)
        await expect(
          page.getByRole('heading', {
            name: translated.purchases.recent,
            exact: true,
          }),
        ).toBeVisible()
        const pager = page
          .getByRole('navigation', {
            name: translated.purchases.title,
            exact: true,
          })
          .first()
        await expect(pager).toContainText(
          translated.sellersList.pageOf
            .replace('{page}', '2')
            .replace('{pages}', '2'),
        )
        const previous = pager.getByRole('link', {
          name: translated.sellersList.previousPage,
          exact: true,
        })
        await expect(previous).toBeVisible()
        const box = (await previous.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(320)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        if (locale === 'sv')
          await page.screenshot({
            path: 'private/purchases-page2-320.png',
            fullPage: true,
            caret: 'initial',
          })
      })
    }
  } finally {
    await f.close()
  }
})
