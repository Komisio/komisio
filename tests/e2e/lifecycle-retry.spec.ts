import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

const cases = [
  {
    action: 'setItemPrice',
    event: 'price_set',
    button: d.lifecycle.setPrice,
    outcome: d.lifecycle.priceSet,
  },
  {
    action: 'extendSalePeriod',
    event: 'period_extended',
    button: d.lifecycle.extend,
    outcome: d.lifecycle.extended,
  },
  {
    action: 'endSalePeriod',
    event: 'period_ended',
    button: d.lifecycle.end,
    outcome: null,
  },
  {
    action: 'applyMarkdown',
    event: 'markdown_applied',
    button: d.lifecycle.applyMarkdown.replace('{step}', '1'),
    outcome: null,
  },
] as const

for (const c of cases)
  test(`${c.action} keeps its retry identity and prevents another lifecycle action from claiming its outcome`, async ({
    page,
  }) => {
    const email = `lifecycle-retry-${randomUUID()}@example.test`
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      const item = await f.item('Synthetic lifecycle retry')
      await f.commit()
      await page.setViewportSize({ width: 320, height: 800 })
      await page.goto(`/intake/lifecycle?q=${item}`)
      const actions = page.locator('.lifecycle-actions')
      if (c.action === 'setItemPrice') {
        await actions.getByLabel(d.lifecycle.price, { exact: true }).fill('125')
        await actions
          .getByLabel(d.lifecycle.priceReason, { exact: true })
          .fill('Synthetic price reason')
      } else if (c.action === 'extendSalePeriod') {
        await actions.getByLabel(d.lifecycle.days, { exact: true }).fill('21')
        await actions
          .getByLabel(d.lifecycle.reason, { exact: true })
          .fill('Synthetic period reason')
      } else if (c.action === 'endSalePeriod') {
        await actions
          .getByLabel(d.lifecycle.endAction, { exact: true })
          .selectOption('return')
        await actions
          .getByLabel(d.lifecycle.note, { exact: true })
          .fill('Synthetic arranged collection')
        await actions.getByRole('checkbox').check()
      }
      const commands: Record<string, unknown>[] = []
      await page.route('**/api/intake', async (route) => {
        const command = route.request().postDataJSON()
        commands.push(command)
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        if (commands.length === 1)
          await route.fulfill({
            status: 503,
            json: { error: 'REQUEST_FAILED' },
          })
        else await route.fulfill({ response })
      })
      await actions.getByRole('button', { name: c.button, exact: true }).click()
      await expect(actions.getByRole('alert')).toHaveText(d.intake.failed)
      for (const input of await actions.locator('input, select').all())
        await expect(input).toBeDisabled()
      for (const original of cases)
        await expect(
          actions.getByRole('button', { name: original.button, exact: true }),
        ).toBeDisabled()
      await expect(actions.getByRole('status')).toHaveCount(0)
      await actions
        .getByRole('button', { name: d.intake.retry, exact: true })
        .click()
      await expect.poll(() => commands.length).toBe(2)
      expect(commands[0].action).toBe(c.action)
      expect(commands[1]).toEqual(commands[0])
      await expect
        .poll(
          async () =>
            (
              await f.db.query(
                'select count(*)::int n from item_events where item_id=$1 and id=$2 and kind=$3',
                [item, commands[0].requestId, c.event],
              )
            ).rows[0].n,
        )
        .toBe(1)
      if (c.outcome)
        await expect(actions.getByRole('status')).toHaveText(c.outcome)
      else if (c.action === 'endSalePeriod') {
        await expect(page.locator('.lifecycle-status')).toHaveText(
          d.lifecycle.stages.ended,
        )
        await expect(actions).toHaveCount(0)
      } else
        await expect(
          actions.getByRole('button', { name: c.button, exact: true }),
        ).toHaveCount(0)
      if (c.action === 'setItemPrice') {
        expect(
          (
            await f.db.query(
              "select count(*)::int n from item_events where item_id=$1 and kind='period_extended'",
              [item],
            )
          ).rows[0].n,
        ).toBe(0)
        await expect(
          actions.getByLabel(d.lifecycle.price, { exact: true }),
        ).toBeEnabled()
        await actions
          .getByLabel(d.lifecycle.reason, { exact: true })
          .fill('Synthetic later extension')
        await actions
          .getByRole('button', { name: d.lifecycle.extend, exact: true })
          .click()
        await expect(actions.getByRole('status')).toHaveText(
          d.lifecycle.extended,
        )
        expect(commands).toHaveLength(3)
        expect(commands[2].action).toBe('extendSalePeriod')
        expect(commands[2].requestId).not.toBe(commands[0].requestId)
        expect(
          (
            await f.db.query(
              "select count(*)::int n from item_events where item_id=$1 and kind='period_extended'",
              [item],
            )
          ).rows[0].n,
        ).toBe(1)
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

test('a definitive lifecycle input refusal permits correction; stale context offers reload', async ({
  page,
}) => {
  const email = `lifecycle-refusal-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic lifecycle correction')
    await f.commit()
    await page.goto(`/intake/lifecycle?q=${item}`)
    const actions = page.locator('.lifecycle-actions')
    const price = actions.getByLabel(d.lifecycle.price, { exact: true })
    await price.fill('125')
    await actions
      .getByLabel(d.lifecycle.priceReason, { exact: true })
      .fill('Synthetic correction')
    let calls = 0
    await page.route('**/api/intake', async (route) => {
      calls++
      await route.fulfill({
        status: calls === 1 ? 400 : 409,
        json: { error: calls === 1 ? 'INVALID_INPUT' : 'TENANT_CHANGED' },
      })
    })
    const submit = actions.getByRole('button', {
      name: d.lifecycle.setPrice,
      exact: true,
    })
    await submit.click()
    await expect(actions.getByRole('alert')).toHaveText(d.intake.invalid)
    await expect(price).toBeEnabled()
    await expect(
      actions.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await price.fill('130')
    await submit.click()
    await expect(actions.getByRole('alert')).toHaveText(d.intake.changed)
    await expect(price).toBeDisabled()
    await expect(submit).toBeDisabled()
    await expect(
      actions.getByRole('button', { name: d.intake.retry, exact: true }),
    ).toHaveCount(0)
    await actions
      .getByRole('button', { name: d.intake.reload, exact: true })
      .click()
    await expect(price).toBeEnabled()
    await expect(price).toHaveValue('')
    expect(calls).toBe(2)
  } finally {
    await f.close()
  }
})
