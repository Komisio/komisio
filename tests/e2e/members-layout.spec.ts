import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import type { Dictionary } from '../../lib/i18n'

test('member identities and complete role controls fit a phone in every language without changing access', async ({
  page,
}) => {
  const email = `members-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.commit()
    for (const role of ['admin', 'staff', 'readonly']) {
      const actor = randomUUID()
      const email = `synthetic.long.member.${role}.${actor}@example.test`
      await f.db.query(
        'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
        [actor, email],
      )
      const token = randomBytes(32).toString('hex')
      await f.asActor(f.actor, () =>
        f.db.query('select create_invitation($1,$2,$3,$4)', [
          f.tenant,
          email,
          role,
          token,
        ]),
      )
      await f.asActor(actor, async () => {
        await f.db.query('select accept_invitation($1)', [token])
        await f.db.query("select save_profile($1,'sv')", [
          `Synthetic ${role} with a longer display name`,
        ])
      })
    }
    await f.asActor(f.actor, () =>
      f.db.query('select create_invitation($1,$2,$3,$4)', [
        f.tenant,
        `synthetic.long.pending.invitation.${randomUUID()}@example.test`,
        'staff',
        randomBytes(32).toString('hex'),
      ]),
    )
    const before = (
      await f.db.query(
        'select user_id,role from tenant_members where tenant_id=$1 order by user_id',
        [f.tenant],
      )
    ).rows
    let writes = 0
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/api/platform')
      )
        writes++
    })
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
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
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/members')
        const directory = page.getByRole('table', {
          name: d.members,
          exact: true,
        })
        await expect(directory.getByRole('row')).toHaveCount(5)
        const invitations = page.getByRole('table', {
          name: d.pendingInvites,
          exact: true,
        })
        await expect(invitations.getByRole('row')).toHaveCount(2)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width)
        if (width === 320) {
          for (const table of [directory, invitations]) {
            const overflow = await table.evaluate(
              (el) => el.scrollWidth > el.clientWidth,
            )
            expect(overflow).toBe(false)
          }
          const dimensions = await directory
            .locator('select')
            .evaluateAll((elements) =>
              elements.map((el) => {
                const select = el as HTMLSelectElement
                const box = select.getBoundingClientRect()
                const style = getComputedStyle(select)
                const context = document
                  .createElement('canvas')
                  .getContext('2d')!
                context.font = `${style.fontSize} ${style.fontFamily}`
                return {
                  width: box.width,
                  height: box.height,
                  font: parseFloat(style.fontSize),
                  required:
                    context.measureText(select.selectedOptions[0].text).width +
                    parseFloat(style.paddingLeft) +
                    parseFloat(style.paddingRight) +
                    24,
                }
              }),
            )
          for (const dimension of dimensions) {
            expect(dimension.font).toBeGreaterThanOrEqual(16)
            expect(dimension.height).toBeGreaterThanOrEqual(44)
            expect(dimension.width).toBeGreaterThanOrEqual(dimension.required)
          }
          if (locale === 'sv')
            await directory.screenshot({
              path: 'private/members-cards-320.png',
            })
        }
      }
      const member = page
        .getByRole('row')
        .filter({ hasText: 'Synthetic admin with a longer display name' })
      await member.getByRole('combobox').selectOption('staff')
      const dialog = page.getByRole('dialog', {
        name: d.changeRole,
        exact: true,
      })
      await expect(dialog).toContainText(
        'Synthetic admin with a longer display name',
      )
      await dialog.getByRole('button', { name: d.cancel, exact: true }).click()
      await expect(member.getByRole('combobox')).toHaveValue('admin')
    }
    expect(writes).toBe(0)
    expect(
      (
        await f.db.query(
          'select user_id,role from tenant_members where tenant_id=$1 order by user_id',
          [f.tenant],
        )
      ).rows,
    ).toEqual(before)
  } finally {
    await f.close()
  }
})
