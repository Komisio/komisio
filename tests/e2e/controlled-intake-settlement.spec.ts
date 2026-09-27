import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }
import de from '../../messages/de.json' with { type: 'json' }

// One consignment through the actual staff UI on a phone: receive the bag,
// register one item, open its browser label, record its sale, settle the
// seller's credit. The fixture only supplies the account, the store, the
// seller, the agreement evidence and the policy; every custody, item, sale
// and settlement fact below is created by the pages themselves.
// The journey ends at an APPROVED settlement (credit reserved for payout).
// Nothing is paid, no statement is issued, no printer, POS, e-mail or bank
// is involved.
test('controlled journey: receive, register, label, sell and approve a settlement through the UI', async ({
  page,
}, testInfo) => {
  const email = `controlled-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    // Layout is checked softly so one overflowing page still lets the chain of
    // facts run to the end; on failure the elements that stick out are named.
    const noOverflow = async () => {
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        elements: [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > innerWidth)
          .slice(0, 8)
          .map(
            (el) =>
              el.tagName.toLowerCase() +
              ' class=' +
              (el.getAttribute('class') ?? '') +
              ' right=' +
              Math.round(el.getBoundingClientRect().right),
          ),
      }))
      expect
        .soft(
          layout.width,
          'page ' + page.url() + ': ' + layout.elements.join('; '),
        )
        .toBeLessThanOrEqual(layout.viewport)
    }

    // 1. Receive the handover as a bag for the fixture seller.
    await page.goto(`/intake?seller=${f.seller}#new-seller`)
    const receiving = page.locator('#new-seller')
    await expect(
      receiving.getByRole('heading', { name: d.intake.receive, exact: true }),
    ).toBeVisible()
    await receiving
      .getByLabel(d.intake.note, { exact: true })
      .fill('Synthetic controlled consignment')
    await receiving.getByLabel(d.intake.custody, { exact: true }).check()
    await receiving
      .getByRole('button', { name: d.intake.saveBag, exact: true })
      .click()
    await expect(receiving.getByRole('status')).toContainText(d.intake.saved)
    await noOverflow()
    const bagHref = await receiving
      .getByRole('status')
      .locator('a[href^="/intake/bags/"]')
      .getAttribute('href')
    const bagId = bagHref!.split('/')[3]
    const bags = (
      await f.db.query(
        'select id,seller_id from bag_receipts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(bags).toEqual([{ id: bagId, seller_id: f.seller }])

    // 2. Register one 400 SEK item from the bag page (quick reception).
    await page.goto(`/intake/bags/${bagId}/inspect`)
    await page
      .getByLabel(d.quickIntake.description, { exact: true })
      .fill('Synthetic wool coat')
    await page.getByLabel(d.quickIntake.price, { exact: true }).fill('400')
    await page
      .getByRole('button', { name: d.bagIntake.save, exact: true })
      .click()
    const row = page.locator('.bag-received-items li').first()
    await expect(row).toContainText('Synthetic wool coat')
    await expect(row).toContainText('400,00')
    await noOverflow()
    const itemHref = await row.locator('a').getAttribute('href')
    const itemId = itemHref!.split('/').at(-1)!
    const items = (
      await f.db.query(
        'select id,seller_id,origin_kind,ownership from items where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(items).toEqual([
      {
        id: itemId,
        seller_id: f.seller,
        origin_kind: 'reception_review',
        ownership: 'consignment',
      },
    ])
    expect(
      (
        await f.db.query(
          'select price_ore from item_prices where tenant_id=$1 and item_id=$2 order by seq desc limit 1',
          [f.tenant, itemId],
        )
      ).rows[0].price_ore,
    ).toBe('40000')
    const reference = 'I-' + itemId.slice(0, 8).toUpperCase()

    // 3. Open the browser label; the print dialog is stubbed, nothing is sent anywhere.
    await page.goto(`/intake/items/${itemId}`)
    await page
      .getByRole('link', { name: d.printing.browserOpen, exact: true })
      .click()
    const label = page.locator('.item-browser-label')
    await expect(label).toContainText('400.00 SEK')
    await expect(label).toContainText('Synthetic wool coat')
    await expect(label).toContainText(reference)
    await expect
      .poll(() =>
        label
          .locator('img')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true)
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'true'
      }
    })
    await page
      .getByRole('button', { name: d.printing.browserPrint, exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute(
      'data-print-requested',
      'true',
    )
    expect(
      (
        await f.db.query(
          'select count(*)::int n from print_jobs where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(0)
    await page.screenshot({
      path: testInfo.outputPath('controlled-label-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })

    // 4. Record the sale at the list price through the sales page.
    await page.goto('/intake/sales')
    await page.getByText(d.sales.recordHeading, { exact: true }).click()
    const search = page.getByLabel(d.sales.search, { exact: true })
    await search.fill(reference)
    await search.press('Enter')
    await page.getByRole('button', { name: d.sales.add, exact: true }).click()
    await expect(page.locator('.sale-cart li')).toHaveCount(1)
    await expect(page.locator(`#price-${itemId}`)).toHaveValue(/400/)
    await expect(page.locator('.sale-total')).toContainText('400.00 SEK')
    await page.getByLabel(d.sales.confirm, { exact: true }).check()
    await page
      .getByRole('button', { name: d.sales.record, exact: true })
      .click()
    await expect(
      page.getByText(d.sales.recorded, { exact: false }),
    ).toBeVisible()
    await noOverflow()
    const sales = (
      await f.db.query(
        'select id,status,total_ore,provider from sales where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({
      status: 'completed',
      total_ore: '40000',
      provider: 'manual',
    })
    const lines = (
      await f.db.query(
        'select item_id,price_ore,ownership,commission_basis,commission_rate_percent,commission_ore,commission_vat_ore,seller_credit_ore from sale_lines where tenant_id=$1 and sale_id=$2',
        [f.tenant, sales[0].id],
      )
    ).rows
    // 60 percent inclusive commission on 400 SEK: 240 SEK to the store, 160 SEK credited.
    expect(lines).toEqual([
      {
        item_id: itemId,
        price_ore: '40000',
        ownership: 'consignment',
        commission_basis: 'inclusive',
        commission_rate_percent: '60.00',
        commission_ore: '24000',
        commission_vat_ore: '0',
        seller_credit_ore: '16000',
      },
    ])
    const ledgerAfterSale = (
      await f.db.query(
        'select kind,amount_ore,reference_kind from seller_ledger_entries where tenant_id=$1 and seller_id=$2 order by recorded_at,id',
        [f.tenant, f.seller],
      )
    ).rows
    expect(ledgerAfterSale).toEqual([
      { kind: 'credit_sale', amount_ore: '16000', reference_kind: 'sale_line' },
    ])

    // 5. Approve the settlement batch for every seller above the threshold (this seller, 160 SEK).
    await page.goto('/intake/payouts')
    const settle = page.locator('section', {
      has: page.getByRole('heading', {
        name: d.payouts.settleHeading,
        exact: true,
      }),
    })
    await expect(settle.getByText(/160\.00 SEK/).first()).toBeVisible()
    await settle
      .getByLabel(d.payouts.settleReason, { exact: true })
      .fill('Synthetic controlled settlement')
    await settle.getByLabel(d.payouts.settleConfirm, { exact: true }).check()
    await settle
      .getByRole('button', {
        name: d.payouts.settle.replace('{count}', '1'),
        exact: true,
      })
      .click()
    await expect(
      page.getByText(d.payouts.settled, { exact: true }),
    ).toBeVisible()
    // Wait for the refreshed server view: the approved payout must be visible
    // and the reserved credit must no longer be offered for another batch.
    const payoutList = page.locator('section', {
      has: page.getByRole('heading', { name: d.payouts.list, exact: true }),
    })
    await expect(payoutList.locator('strong')).toContainText(
      d.payouts.statuses.approved,
    )
    await expect(
      payoutList.getByRole('button', { name: d.payouts.markPaid, exact: true }),
    ).toBeVisible()
    await expect(
      settle.getByText(d.payouts.settleEmpty, { exact: true }),
    ).toBeVisible()
    await noOverflow()
    await page.screenshot({
      path: testInfo.outputPath('controlled-settlement-mobile.png'),
      fullPage: true,
      caret: 'initial',
    })
    const payouts = (
      await f.db.query(
        'select seller_id,status,amount_ore,rail,paid_at from payouts where tenant_id=$1',
        [f.tenant],
      )
    ).rows
    expect(payouts).toEqual([
      {
        seller_id: f.seller,
        status: 'approved',
        amount_ore: '16000',
        rail: 'manual',
        paid_at: null,
      },
    ])
    const ledger = (
      await f.db.query(
        'select kind,amount_ore,reference_kind from seller_ledger_entries where tenant_id=$1 and seller_id=$2 order by recorded_at,id',
        [f.tenant, f.seller],
      )
    ).rows
    expect(ledger).toEqual([
      { kind: 'credit_sale', amount_ore: '16000', reference_kind: 'sale_line' },
      {
        kind: 'payout_reserved',
        amount_ore: '-16000',
        reference_kind: 'payout',
      },
    ])
    expect(
      (
        await f.db.query(
          'select payout_count,reason from payout_batches where tenant_id=$1',
          [f.tenant],
        )
      ).rows,
    ).toEqual([{ payout_count: 1, reason: 'Synthetic controlled settlement' }])
    // The saved-item confirmation must also fit a phone with the longest action text (German).
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'de', url: 'http://127.0.0.1:3000' },
      ])
    await page.goto(`/intake/bags/${bagId}/inspect`)
    // The description label comes from the store's attribute vocabulary, not from the UI
    // dictionary, so the first text field of the item form is used here.
    await page
      .locator('.quick-item')
      .getByRole('textbox')
      .first()
      .fill('Synthetic second coat')
    await page.getByLabel(de.quickIntake.price, { exact: true }).fill('50')
    await page
      .getByRole('button', { name: de.bagIntake.save, exact: true })
      .click()
    const doneCard = page.getByRole('region', { name: de.quickIntake.done })
    await expect(
      doneCard.getByRole('button', { name: de.bagIntake.next, exact: true }),
    ).toBeVisible()
    await expect(
      doneCard.getByRole('link', {
        name: de.quickIntake.openItem,
        exact: true,
      }),
    ).toBeVisible()
    await noOverflow()
    await page
      .context()
      .addCookies([
        { name: 'komisio-locale', value: 'sv', url: 'http://127.0.0.1:3000' },
      ])

    // Boundary of this journey: nothing paid, no statement, no communication, no print job.
    for (const table of [
      'settlement_statements',
      'seller_communications',
      'print_jobs',
    ])
      expect(
        (
          await f.db.query(
            `select count(*)::int n from ${table} where tenant_id=$1`,
            [f.tenant],
          )
        ).rows[0].n,
        table,
      ).toBe(0)
  } finally {
    await f.close()
  }
})
