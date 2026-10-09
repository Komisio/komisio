import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('a store day keeps twenty items, seller changes and interrupted bag work distinct', async ({
  page,
}, testInfo) => {
  test.setTimeout(240000)
  const email = `store-day-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const other = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Synthetic second seller',
        `second-${randomUUID()}@example.test`,
        '',
      ])
    ).rows[0].id
    await f.db.query('select record_agreement_evidence($1,$2,$3,$4,$5)', [
      f.tenant,
      randomUUID(),
      other,
      f.agreement,
      'Synthetic paper agreement',
    ])
    const bag = (
      await f.db.query('select receive_bag_with_agreement($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        other,
        'Synthetic blue bag',
        f.agreement,
      ])
    ).rows[0].id
    await f.commit()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intake/quick')
    await page.getByRole('button', { name: /Synthetic P2 seller/ }).click()
    const description = page.getByLabel(d.quickIntake.description, {
      exact: true,
    })
    const price = page.getByLabel(d.quickIntake.price, { exact: true })
    const done = page.getByRole('region', {
      name: d.quickIntake.done,
      exact: true,
    })
    const evidence: Record<string, unknown> = {}
    const accepted: { id: string; seller: string; priceOre: number }[] = []

    // A real validation attempt: do not merely inspect component source.
    await description.fill('Synthetic day item 1')
    await price.fill('invalid')
    await price.press('Enter')
    await expect(page.locator('.quick-item').getByRole('alert')).toContainText(
      d.quickIntake.fillIn,
    )
    evidence.invalidPrice = await price.evaluate((element) => ({
      markedInvalid: element.getAttribute('aria-invalid'),
      description: element.getAttribute('aria-describedby'),
    }))
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await expect(price).toHaveAccessibleDescription(d.quickIntake.priceInvalid)

    for (let index = 0; index < 20; index++) {
      if (index === 5) {
        await page
          .getByRole('button', {
            name: d.quickIntake.changeSeller,
            exact: true,
          })
          .click()
        await expect(page.getByLabel(d.quickIntake.searchSeller)).toBeFocused()
        await page
          .getByRole('button', { name: /Synthetic second seller/ })
          .click()
      } else if (index === 10) {
        await page.goto(`/intake/bags/${bag}/inspect`)
        await expect(page.locator('.bag-note')).toHaveText('Synthetic blue bag')
      } else if (index > 0 && index !== 15) {
        await page
          .getByRole('button', {
            name: index > 10 ? d.bagIntake.next : d.quickIntake.next,
            exact: true,
          })
          .click()
        await expect(page.locator('.quick-item h2')).toBeFocused()
        await expect(description).toHaveValue('')
        await expect(price).toHaveValue('')
      }
      const title = `Synthetic day item ${index + 1}`
      const amount = 100 + index
      await description.fill(title)
      await price.fill(`${amount},50`)
      if (index === 12) {
        // A distraction must not silently discard the partially entered item.
        const dialog = page.waitForEvent('dialog')
        const navigation = page
          .getByRole('link', { name: d.intake.back, exact: true })
          .click()
        await (await dialog).dismiss()
        await navigation
        await expect(description).toHaveValue(title)
        await expect(price).toHaveValue(`${amount},50`)
      }
      if (index === 15) {
        await page.locator('#quick-photo').setInputFiles({
          name: 'synthetic-item.png',
          mimeType: 'image/png',
          buffer: await sharp({
            create: {
              width: 80,
              height: 80,
              channels: 3,
              background: '#b0ada6',
            },
          })
            .png()
            .toBuffer(),
        })
        await expect(page.locator('.quick-photo-picker img')).toBeVisible()
        await expect(price).toBeEnabled()
      }
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/intake/quick') &&
          r.request().method() === 'POST',
      )
      await price.press('Enter')
      const saved = await (await response).json()
      await expect(done).toBeVisible()
      await expect(done).toContainText(title)
      await expect(done.locator('.quick-confirmation-details')).toContainText(
        index < 5 ? 'Synthetic P2 seller' : 'Synthetic second seller',
      )
      await expect(done.locator('.quick-confirmation-details')).toContainText(
        new Intl.NumberFormat('sv-SE', {
          style: 'currency',
          currency: 'SEK',
          currencyDisplay: 'code',
        }).format(amount + 0.5),
      )
      await expect(done.getByRole('heading')).toBeFocused()
      accepted.push({
        id: saved.itemId,
        seller: index < 5 ? f.seller : other,
        priceOre: amount * 100 + 50,
      })
      if (index === 0 || index === 10) {
        evidence[index === 0 ? 'counterConfirmation' : 'bagConfirmation'] =
          await done.innerText()
        await page.screenshot({
          path: testInfo.outputPath(`confirmation-${index}.png`),
          caret: 'initial',
        })
      }
      if (index === 14) {
        await page.reload()
        await expect(page.locator('.bag-received-items li')).toHaveCount(5)
        // Reload resumes saved bag context, with a fresh item editor.
        await description.fill('Synthetic temporary item')
        const dialog = page.waitForEvent('dialog')
        await page.evaluate(() => {
          setTimeout(() => window.location.reload(), 0)
        })
        await (await dialog).dismiss()
        await expect(description).toHaveValue('Synthetic temporary item')
        await description.fill('')
        await page.reload()
      }
      if (index === 15) evidence.photoSaved = true
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    expect(new Set(accepted.map((item) => item.id)).size).toBe(20)
    const stored = (
      await f.db.query(
        "select i.id, i.seller_id, p.price_ore from items i join item_prices p on p.tenant_id=i.tenant_id and p.item_id=i.id and p.reason='accepted' where i.tenant_id=$1 order by i.id",
        [f.tenant],
      )
    ).rows
    expect(stored).toHaveLength(20)
    for (const item of accepted) {
      const row = stored.find((row: { id: string }) => row.id === item.id)
      expect(row.seller_id).toBe(item.seller)
      expect(Number(row.price_ore)).toBe(item.priceOre)
    }
    await page.reload()
    await expect(page.locator('.bag-received-items li')).toHaveCount(10)
    await expect(page.locator('[data-bag-count="accepted"]')).toHaveText('10')
    await expect(
      page
        .getByRole('region', { name: d.bagProcessing.title, exact: true })
        .locator('[data-bag-processing-state]'),
    ).toHaveText(d.bagProcessing.open)
    await page
      .locator('.bag-received-items li')
      .filter({ hasText: 'Synthetic day item 16' })
      .getByRole('link')
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/intake/items/${accepted[15].id}$`),
    )

    // Synthetic engine events only: no actual checkout, transfer or provider call.
    await f.asActor(f.actor, () =>
      f.db.query(
        "select record_sale($1,$2,'manual',$3,now(),'SEK',$4::jsonb)",
        [
          f.tenant,
          randomUUID(),
          randomUUID(),
          JSON.stringify([{ itemId: accepted[0].id, priceOre: 9000 }]),
        ],
      ),
    )
    const balance = await f.asActor(
      f.actor,
      async () =>
        (
          await f.db.query('select seller_balance($1,$2) b', [
            f.tenant,
            f.seller,
          ])
        ).rows[0].b,
    )
    await page.goto(`/intake/sellers/${f.seller}#seller-items`)
    const sold = page
      .getByRole('tabpanel')
      .locator('li')
      .filter({ hasText: 'Synthetic day item 1' })
    await expect(sold).toContainText(d.lifecycle.stages.sold)
    await expect(sold.locator('strong')).toHaveText('90.00 SEK')
    await page
      .getByRole('tab', { name: d.sellerWorkspace.economy, exact: true })
      .click()
    await expect(page.locator('.seller-balance-primary dd')).toContainText(
      (Number(balance.availableOre) / 100).toFixed(2),
    )
    evidence.received = 20
    evidence.bagAccepted = 10
    evidence.sellerCounts = [5, 15]
    evidence.salePriceOre = 9000
    evidence.balance = balance
    const observations = testInfo.outputPath('store-day-observations.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(observations, JSON.stringify(evidence, null, 2))
    await testInfo.attach('store-day-observations', {
      path: observations,
      contentType: 'application/json',
    })
  } finally {
    await f.close()
  }
})
