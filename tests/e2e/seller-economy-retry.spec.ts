import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const action of ['adjustSellerLedger', 'issueStatement'] as const)
  test(`${action} retries the original validated form after a lost response`, async ({
    page,
  }) => {
    const email = `seller-economy-retry-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(`/intake/sellers/${f.seller}#seller-economy`)
      if (action === 'adjustSellerLedger')
        await page
          .locator('summary')
          .filter({ hasText: d.ledger.adjustHeading })
          .click()
      const form = page.locator('form').filter({
        has: page.locator(
          action === 'adjustSellerLedger'
            ? '#ledger-amount'
            : '#statement-from',
        ),
      })
      if (action === 'adjustSellerLedger') {
        await form.getByLabel(d.ledger.amount, { exact: true }).fill('-12,50')
        await form
          .getByLabel(d.ledger.reason, { exact: true })
          .fill('Synthetic recorded correction')
      } else {
        await form
          .getByLabel(d.statements.from, { exact: true })
          .fill('2025-03-30')
        await form
          .getByLabel(d.statements.to, { exact: true })
          .fill('2025-03-30')
      }
      await form.getByRole('checkbox').check()
      const requests: Record<string, unknown>[] = []
      let committedId = ''
      let firstStatus = 0
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command?.action !== action) return route.continue()
        requests.push(command)
        if (requests.length === 1) {
          const response = await route.fetch()
          firstStatus = response.status()
          committedId = (await response.json()).id
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'REQUEST_FAILED' }),
          })
        } else await route.continue()
      })
      await form
        .getByRole('button', {
          name:
            action === 'adjustSellerLedger'
              ? d.ledger.adjust
              : d.statements.issue,
          exact: true,
        })
        .click()
      await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
      expect(firstStatus).toBe(200)
      expect(committedId).toBe(requests[0].requestId)
      await expect(
        form.locator(
          action === 'adjustSellerLedger'
            ? '#ledger-amount'
            : '#statement-from',
        ),
      ).toBeDisabled()
      await form
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect.poll(() => requests.length).toBe(2)
      expect(requests[1]).toEqual(requests[0])
      if (action === 'adjustSellerLedger') {
        await expect(form.getByRole('status')).toHaveText(d.ledger.adjusted)
        expect(
          (
            await f.db.query(
              'select id,amount_ore::text,reason from seller_ledger_entries where tenant_id=$1 and seller_id=$2',
              [f.tenant, f.seller],
            )
          ).rows,
        ).toEqual([
          {
            id: committedId,
            amount_ore: '-1250',
            reason: 'Synthetic recorded correction',
          },
        ])
      } else {
        await expect(
          form.getByRole('link', { name: d.statements.open, exact: true }),
        ).toHaveAttribute('href', `/intake/statements/${committedId}`)
        const rows = (
          await f.db.query(
            'select id,number,period_from,period_to from settlement_statements where tenant_id=$1 and seller_id=$2',
            [f.tenant, f.seller],
          )
        ).rows
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe(committedId)
        expect(rows[0].number).toBe(1)
        expect(rows[0].period_from.toISOString()).toBe(
          '2025-03-29T23:00:00.000Z',
        )
        expect(rows[0].period_to.toISOString()).toBe('2025-03-30T22:00:00.000Z')
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    } finally {
      await f.close()
    }
  })
