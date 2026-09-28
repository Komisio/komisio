import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

for (const action of ['registerSeller', 'receiveBag'] as const) {
  for (const failure of [
    'missing-id',
    'foreign-id',
    'lost-then-refused',
  ] as const) {
    test(`${action} retains its identity after ${failure}`, async ({
      page,
    }) => {
      const email = `receiving-retry-${randomUUID()}@example.test`
      await register(page, email, `K!${randomBytes(16).toString('hex')}`)
      const f = await p2Fixture(email)
      try {
        await f.commit()
        await page.setViewportSize({ width: 320, height: 720 })
        await page.goto(
          action === 'receiveBag'
            ? `/intake?seller=${f.seller}#new-seller`
            : '/intake',
        )
        const panel = page.locator('#new-seller').locator('.intake-form')
        const commands: Record<string, unknown>[] = []
        let savedId = ''
        let firstStatus = 0
        await page.route('**/api/intake', async (route) => {
          const command = route.request().postDataJSON()
          if (command.action !== action) return route.continue()
          commands.push(command)
          if (commands.length === 2 && failure === 'lost-then-refused') {
            return route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'INVALID_INPUT' }),
            })
          }
          if (commands.length !== 1) return route.continue()
          const response = await route.fetch()
          firstStatus = response.status()
          savedId = (await response.json()).id
          // The engine committed; the browser receives an unusable reply.
          await route.fulfill({
            status: failure === 'lost-then-refused' ? 503 : 200,
            contentType: 'application/json',
            body: JSON.stringify(
              failure === 'lost-then-refused'
                ? { error: 'REQUEST_FAILED' }
                : failure === 'foreign-id'
                  ? { ok: true, id: randomUUID() }
                  : { ok: true },
            ),
          })
        })
        if (action === 'receiveBag') {
          await panel
            .getByLabel(d.intake.note, { exact: true })
            .fill('Synthetic reception retry')
          await panel.getByRole('checkbox').check()
        } else {
          await panel
            .getByLabel(d.intake.name, { exact: true })
            .fill('Synthetic response retry seller')
          await panel
            .getByLabel(d.intake.email, { exact: true })
            .fill(`new-${randomUUID()}@example.test`)
        }
        await panel
          .getByRole('button', {
            name:
              action === 'receiveBag' ? d.intake.saveBag : d.intake.saveSeller,
            exact: true,
          })
          .click()
        await expect(panel.getByRole('alert')).toHaveText(d.intake.failed)
        expect(firstStatus).toBe(200)
        expect(savedId).toMatch(/^[0-9a-f-]{36}$/)
        await expect(
          panel.getByLabel(
            action === 'receiveBag' ? d.intake.note : d.intake.name,
            { exact: true },
          ),
        ).toBeDisabled()
        const retry = panel.getByRole('button', {
          name: d.intake.retry,
          exact: true,
        })
        await expect(retry).toBeEnabled()
        const refused =
          failure === 'lost-then-refused'
            ? page.waitForResponse(
                (response) =>
                  response.url().endsWith('/api/intake') &&
                  response.status() === 400,
              )
            : null
        await retry.click()
        if (failure === 'lost-then-refused') {
          await refused
          await expect(panel.getByRole('alert')).toHaveText(d.intake.failed)
          await expect(
            panel.getByLabel(
              action === 'receiveBag' ? d.intake.note : d.intake.name,
              { exact: true },
            ),
          ).toBeDisabled()
          await expect(retry).toBeEnabled()
          await retry.click()
        }
        if (action === 'receiveBag') {
          await expect(panel.locator('.intake-success a')).toHaveAttribute(
            'href',
            `/intake/bags/${savedId}`,
          )
        } else {
          await expect(page).toHaveURL(`/intake?seller=${savedId}#new-seller`)
        }
        expect(commands).toHaveLength(failure === 'lost-then-refused' ? 3 : 2)
        for (const command of commands.slice(1))
          expect(command).toEqual(commands[0])
        const table = action === 'receiveBag' ? 'bag_receipts' : 'sellers'
        const expected = action === 'receiveBag' ? 1 : 2 // One fixture seller already exists.
        const count = await f.db.query(
          `select count(*)::int as count from ${table} where tenant_id=$1`,
          [f.tenant],
        )
        expect(count.rows[0].count).toBe(expected)
        const event =
          action === 'receiveBag' ? 'bag.received' : 'seller.registered'
        const events = await f.db.query(
          'select count(*)::int as count from access_events where tenant_id=$1 and action=$2 and target_id=$3',
          [f.tenant, event, savedId],
        )
        expect(events.rows[0].count).toBe(1)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
      } finally {
        await f.close()
      }
    })
  }
}
