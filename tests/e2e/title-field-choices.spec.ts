import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import sv from '../../messages/sv.json' with { type: 'json' }
import en from '../../messages/en.json' with { type: 'json' }

const dictionaries = { sv, en }

for (const locale of ['sv', 'en'] as const) {
  test(`automatic item names use localized field choices and persist in ${locale}`, async ({
    page,
  }, testInfo) => {
    const d = dictionaries[locale]
    const t = d.registration.titleBuilder
    const fields = d.registration.visibility.fields
    const email = `title-fields-${randomUUID()}@example.test`
    await page.setViewportSize({
      width: locale === 'en' ? 390 : 1280,
      height: 900,
    })
    await register(page, email, `K!${randomUUID()}`)
    const f = await p2Fixture(email)
    try {
      await f.commit()
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      await page.goto('/settings?tab=vocabulary#vocabulary-registration')
      const builder = page.getByRole('group', {
        name: d.registration.template,
        exact: true,
      })
      const preview = builder.getByRole('status', {
        name: t.preview,
        exact: true,
      })
      await expect(preview).toContainText(`${t.examples.type} Nord M`)
      await expect(builder).not.toContainText('{type}')
      await expect(builder.getByRole('textbox')).toHaveCount(0)
      const earlier = builder.getByRole('button', {
        name: t.earlier.replace('{field}', fields.brand),
        exact: true,
      })
      await earlier.focus()
      await earlier.press('Enter')
      await expect(builder.getByRole('listitem').first()).toBeFocused()
      await expect(preview).toContainText(`Nord ${t.examples.type} M`)
      await builder
        .getByRole('button', {
          name: t.remove.replace('{field}', fields.size),
          exact: true,
        })
        .click()
      await builder
        .getByRole('combobox', { name: t.add, exact: true })
        .selectOption('color')
      await expect(preview).toContainText(
        `Nord ${t.examples.type} ${t.examples.color}`,
      )
      await expect(builder.getByRole('listitem').last()).toBeFocused()
      let firstRequest: unknown
      let loseReply = true
      if (locale === 'en') {
        await page.route('**/api/registration', async (route) => {
          const body = route.request().postDataJSON()
          if (!firstRequest) firstRequest = body
          else expect(body).toEqual(firstRequest)
          const response = await route.fetch()
          if (loseReply) {
            loseReply = false
            await route.abort('connectionfailed')
          } else await route.fulfill({ response })
        })
      }
      await page
        .getByRole('button', { name: d.registration.save, exact: true })
        .click()
      if (locale === 'en') {
        await expect(builder.getByRole('combobox')).toBeDisabled()
        await expect(builder.getByRole('button').first()).toBeDisabled()
        await page
          .getByRole('button', { name: d.registration.retry, exact: true })
          .click()
      }
      const announcement = page.getByRole('status', {
        name: d.registration.title,
        exact: true,
      })
      await expect(announcement).toHaveText(
        `${d.registration.title}: ${d.registration.saved}`,
      )
      await page.reload()
      await expect(preview).toContainText(
        `Nord ${t.examples.type} ${t.examples.color}`,
      )
      const saved = await f.asActor(
        f.actor,
        async () =>
          (
            await f.db.query('select registration_settings($1) data', [
              f.tenant,
            ])
          ).rows[0].data,
      )
      expect(saved.settings.titleTemplate).toBe('{brand} {type} {color}')
      // Compare the example against the unchanged database renderer.
      const rendered = (
        await f.db.query(
          'select komisio_private.render_registration_title($1,$2::jsonb) title',
          [saved.settings.titleTemplate, JSON.stringify(t.examples)],
        )
      ).rows[0].title
      await expect(preview).toContainText(rendered)
      expect(
        await builder.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await builder.screenshot({
        path: testInfo.outputPath(`title-builder-${locale}.png`),
      })
    } finally {
      await f.close()
    }
  })
}

test('custom titles round-trip unchanged and invalid text cannot be saved', async ({
  page,
}) => {
  const d = sv
  const t = d.registration.titleBuilder
  const email = `title-custom-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const original = 'Vintage: {brand} / {type} ({size})'
  try {
    await f.db.query(
      "select publish_registration_settings($1,$2,null,(registration_settings($1)->'settings') || jsonb_build_object('titleTemplate',$3::text))",
      [f.tenant, randomUUID(), original],
    )
    await f.commit()
    await page.goto('/settings?tab=vocabulary#vocabulary-registration')
    const builder = page.getByRole('group', {
      name: d.registration.template,
      exact: true,
    })
    const save = page.getByRole('button', {
      name: d.registration.save,
      exact: true,
    })
    await expect(builder.getByRole('status')).toContainText(
      'Vintage: Nord / Klänning (M)',
    )
    await expect(save).toBeDisabled()
    // Saving an unrelated setting must not normalize or replace the old template.
    await page
      .getByLabel(d.registration.descriptionRequired, { exact: true })
      .check()
    await save.click()
    await expect(
      page.getByRole('status', { name: d.registration.title, exact: true }),
    ).toContainText(d.registration.saved)
    let saved = await f.asActor(
      f.actor,
      async () =>
        (await f.db.query('select registration_settings($1) data', [f.tenant]))
          .rows[0].data,
    )
    expect(saved.settings.titleTemplate).toBe(original)
    await builder.getByText(t.customize, { exact: true }).click()
    const prefix = builder.getByLabel(t.before, { exact: true })
    await prefix.fill('{unsupported}')
    await expect(prefix).toHaveAttribute('aria-invalid', 'true')
    await expect(builder.getByRole('alert')).toHaveText(t.invalid)
    await expect(save).toBeDisabled()
    await prefix.fill('Collection: ')
    await expect(builder.getByRole('alert')).toHaveCount(0)
    await builder
      .getByRole('button', {
        name: t.earlier.replace(
          '{field}',
          d.registration.visibility.fields.itemType,
        ),
        exact: true,
      })
      .click()
    await expect(builder.getByRole('status')).toContainText(
      'Collection: Klänning / Nord (M)',
    )
    await save.click()
    await expect(
      page.getByRole('status', { name: d.registration.title, exact: true }),
    ).toContainText(d.registration.saved)
    saved = await f.asActor(
      f.actor,
      async () =>
        (await f.db.query('select registration_settings($1) data', [f.tenant]))
          .rows[0].data,
    )
    expect(saved.settings.titleTemplate).toBe(
      'Collection: {type} / {brand} ({size})',
    )
  } finally {
    await f.close()
  }
})
