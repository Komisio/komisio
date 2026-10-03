import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const failureCode of ['REQUEST_FAILED', 'INVALID_INPUT', 'POLICY_CHANGED'])
  for (const action of ['registerPurchase', 'acceptItem'] as const)
    test(`${action} retries locked price fields after a committed server failure (${failureCode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 720 })
      const email = `intake-price-retry-${randomUUID()}@example.test`
      await register(page, email, `K!${randomBytes(16).toString('hex')}`)
      const f = await p2Fixture(email)
      try {
        const origin = randomUUID()
        if (action === 'acceptItem')
          await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
            f.tenant,
            origin,
            'Synthetic acceptance retry',
            10000,
            'Synthetic evidence',
          ])
        await f.commit()
        await page.goto('/intake/purchases')
        await page
          .locator(
            action === 'registerPurchase'
              ? '.purchase-create > summary'
              : '.purchase-accept > summary',
          )
          .click()
        const form = page.locator('form').filter({
          has: page.locator(
            action === 'registerPurchase'
              ? '#purchase-price'
              : `#accept-price-${origin}`,
          ),
        })
        const price = form.getByLabel(
          action === 'registerPurchase' ? d.purchases.price : d.items.price,
          { exact: true },
        )
        await price.fill('145,25')
        if (action === 'registerPurchase') {
          await form
            .getByLabel(d.purchases.evidence, { exact: true })
            .fill('Synthetic receipt reference')
          await form
            .getByLabel(d.purchases.note, { exact: true })
            .fill('Synthetic purchase retry')
          await form.locator('input[name="margin"]').check()
          await form.locator('input[type="checkbox"][required]').check()
        } else await form.getByRole('checkbox').check()
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
              body: JSON.stringify({ error: failureCode }),
            })
          } else await route.continue()
        })
        await form
          .getByRole('button', {
            name:
              action === 'registerPurchase'
                ? d.purchases.register
                : d.items.accept,
            exact: true,
          })
          .click()
        await expect(form.getByRole('alert')).toHaveText(d.intake.failed)
        expect(firstStatus).toBe(200)
        expect(committedId).toBe(requests[0].requestId)
        await expect(price).toBeDisabled()
        const retry = form.getByRole('button', {
          name: d.intake.retry,
          exact: true,
        })
        await expect(retry).toBeEnabled()
        await retry.click()
        await expect.poll(() => requests.length).toBe(2)
        expect(requests[1]).toEqual(requests[0])
        if (action === 'registerPurchase') {
          await expect(form.getByRole('status')).toHaveText(
            d.purchases.registered,
          )
          await expect(price).toBeEnabled()
          await expect(price).toHaveValue('')
          expect(
            (
              await f.db.query(
                'select id,purchase_price_ore::text,evidence_reference,supplier_note,margin_eligible from purchase_receipts where tenant_id=$1',
                [f.tenant],
              )
            ).rows,
          ).toEqual([
            {
              id: committedId,
              purchase_price_ore: '14525',
              evidence_reference: 'Synthetic receipt reference',
              supplier_note: 'Synthetic purchase retry',
              margin_eligible: true,
            },
          ])
        } else {
          await expect(
            page.getByRole('link', { name: new RegExp(d.items.open) }),
          ).toHaveAttribute('href', `/intake/items/${committedId}`)
          expect(
            (
              await f.db.query(
                'select id,origin_id from items where tenant_id=$1',
                [f.tenant],
              )
            ).rows,
          ).toEqual([{ id: committedId, origin_id: origin }])
          expect(
            (
              await f.db.query(
                'select price_ore::text from item_prices where tenant_id=$1 and item_id=$2',
                [f.tenant, committedId],
              )
            ).rows,
          ).toEqual([{ price_ore: '14525' }])
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

for (const action of ['registerPurchase', 'acceptItem'] as const)
  test(`${action} validates freshly edited fields after an answered refusal`, async ({
    page,
  }) => {
    const email = `intake-price-correction-${randomUUID()}@example.test`
    await register(page, email, `K!${randomBytes(16).toString('hex')}`)
    const f = await p2Fixture(email)
    try {
      const origin = randomUUID()
      if (action === 'acceptItem')
        await f.db.query('select register_purchase($1,$2,$3,$4,$5,false)', [
          f.tenant,
          origin,
          'Synthetic corrected acceptance',
          10000,
          'Synthetic evidence',
        ])
      await f.commit()
      await page.goto('/intake/purchases')
      await page
        .locator(
          action === 'registerPurchase'
            ? '.purchase-create > summary'
            : '.purchase-accept > summary',
        )
        .click()
      const form = page.locator('form').filter({
        has: page.locator(
          action === 'registerPurchase'
            ? '#purchase-price'
            : `#accept-price-${origin}`,
        ),
      })
      const price = form.getByLabel(
        action === 'registerPurchase' ? d.purchases.price : d.items.price,
        { exact: true },
      )
      await price.fill('100')
      if (action === 'registerPurchase') {
        await form
          .getByLabel(d.purchases.evidence, { exact: true })
          .fill('Synthetic initial evidence')
        await form.locator('input[type="checkbox"][required]').check()
      } else await form.getByRole('checkbox').check()
      const requests: Record<string, unknown>[] = []
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        if (command?.action !== action) return route.continue()
        requests.push(command)
        // A known, answered rejection before any engine write is correctable.
        if (requests.length === 1)
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'INVALID_INPUT' }),
          })
        else await route.continue()
      })
      const save = form.getByRole('button', {
        name:
          action === 'registerPurchase' ? d.purchases.register : d.items.accept,
        exact: true,
      })
      await save.click()
      await expect(form.getByRole('alert')).toHaveText(d.intake.invalid)
      await expect(price).toBeEnabled()
      expect(
        (
          await f.db.query(
            action === 'registerPurchase'
              ? 'select count(*)::integer n from purchase_receipts where tenant_id=$1'
              : 'select count(*)::integer n from items where tenant_id=$1',
            [f.tenant],
          )
        ).rows[0].n,
      ).toBe(0)
      await price.fill('225,75')
      if (action === 'registerPurchase')
        await form
          .getByLabel(d.purchases.evidence, { exact: true })
          .fill('Synthetic corrected evidence')
      await save.click()
      await expect.poll(() => requests.length).toBe(2)
      expect(requests[1].requestId).toBe(requests[0].requestId)
      expect(
        requests[1][action === 'registerPurchase' ? 'purchasePrice' : 'price'],
      ).toBe('225.75')
      if (action === 'registerPurchase') {
        await expect(form.getByRole('status')).toHaveText(
          d.purchases.registered,
        )
        expect(
          (
            await f.db.query(
              'select purchase_price_ore::text,evidence_reference from purchase_receipts where tenant_id=$1',
              [f.tenant],
            )
          ).rows,
        ).toEqual([
          {
            purchase_price_ore: '22575',
            evidence_reference: 'Synthetic corrected evidence',
          },
        ])
        // A later purchase is a new command and must not reuse the old fields.
        await price.fill('50')
        await form
          .getByLabel(d.purchases.evidence, { exact: true })
          .fill('Synthetic next evidence')
        await form.locator('input[type="checkbox"][required]').check()
        await save.click()
        await expect.poll(() => requests.length).toBe(3)
        expect(requests[2].requestId).not.toBe(requests[1].requestId)
        expect(requests[2].purchasePrice).toBe('50.00')
        await expect
          .poll(async () =>
            Number(
              (
                await f.db.query(
                  'select count(*)::integer n from purchase_receipts where tenant_id=$1',
                  [f.tenant],
                )
              ).rows[0].n,
            ),
          )
          .toBe(2)
      } else {
        await expect(
          page.getByRole('link', { name: new RegExp(d.items.open) }),
        ).toHaveAttribute('href', `/intake/items/${requests[1].requestId}`)
        expect(
          (
            await f.db.query(
              'select price_ore::text from item_prices where tenant_id=$1',
              [f.tenant],
            )
          ).rows,
        ).toEqual([{ price_ore: '22575' }])
      }
    } finally {
      await f.close()
    }
  })
