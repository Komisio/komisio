import { test, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { connectorScopes } from '../../lib/engine/connectors'
import type { Dictionary } from '../../lib/i18n'

const locales = ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it'] as const
const dictionary = (locale: string): Dictionary =>
  JSON.parse(
    readFileSync(
      new URL(`../../messages/${locale}.json`, import.meta.url),
      'utf8',
    ),
  )

test('connected assistants keep all permissions accessible and metadata visible on desktop and mobile', async ({
  page,
}, testInfo) => {
  const email = `connector-layout-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  const client = randomUUID(),
    grant = randomUUID()
  const clientName = 'Synthetic assistant with all permissions'
  const ownerName = 'Synthetic approver'
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex')
  const code = randomUUID(),
    access = randomUUID()
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  try {
    await f.db.query('select save_profile($1,$2)', [ownerName, 'sv'])
    await f.db.query('select register_connector_client($1,$2,$3)', [
      client,
      clientName,
      ['https://assistant.example.test/callback'],
    ])
    await f.db.query('select authorize_connector($1,$2,$3,$4,$5,$6,$7,$8)', [
      grant,
      f.tenant,
      client,
      'https://assistant.example.test/callback',
      [...connectorScopes],
      challenge,
      hash(code),
      'aal1',
    ])
    await f.db.query('select exchange_connector_code($1,$2,$3,$4,$5,$6)', [
      hash(code),
      client,
      'https://assistant.example.test/callback',
      challenge,
      hash(access),
      hash(randomUUID()),
    ])
    await f.db.query('select connector_call($1,$2,$3)', [
      hash(access),
      'tenant_role',
      { p_tenant: f.tenant },
    ])
    await f.commit()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/settings?tab=connectors')
    const d = dictionary('sv').connectors
    const table = page.getByRole('table', { name: d.connectedHeading })
    const row = page.locator('.connectors-table .connector-row')
    await expect(row).toHaveCount(1)
    await expect(row.getByText(clientName, { exact: true })).toBeVisible()
    await expect(row.getByText(ownerName, { exact: false })).toBeVisible()
    await expect(row.locator('.connector-activity time')).toHaveCount(2)
    await expect(row.locator('.connector-activity dd').last()).toHaveText('1')
    await expect(row.locator('.connector-permission-badges')).toContainText(
      'Läsa 6',
    )
    await expect(row.locator('.connector-permission-badges')).toContainText(
      'Föreslå 9',
    )
    await expect(row.locator('.connector-permission-badges')).toContainText(
      'Förhandsgranska 1',
    )
    expect((await row.boundingBox())!.height).toBeLessThan(230)
    const toggle = row.locator('.connector-permissions-toggle')
    await expect(toggle).toHaveAccessibleName(
      `${d.showPermissions}: ${clientName}`,
    )
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const details = table.getByRole('region', {
      name: `${d.scopesLabel}: ${clientName}`,
    })
    for (const scope of connectorScopes)
      await expect(
        details.getByText(d.scopes[scope], { exact: true }),
      ).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('desktop-expanded.png'),
      fullPage: true,
    })
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(details).not.toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('desktop.png'),
      fullPage: true,
    })

    for (const locale of locales) {
      const t = dictionary(locale).connectors
      await page
        .context()
        .addCookies([
          { name: 'komisio-locale', value: locale, url: page.url() },
        ])
      await page.setViewportSize({ width: 375, height: 812 })
      await page.reload()
      await expect(row.getByText(clientName, { exact: true })).toBeVisible()
      await expect(row.getByText(ownerName, { exact: false })).toBeVisible()
      await expect(row.getByText(t.created, { exact: true })).toBeVisible()
      await expect(row.getByText(t.lastUsed, { exact: true })).toBeVisible()
      await expect(row.getByText(t.calls, { exact: true })).toBeVisible()
      await expect(
        row.getByRole('button', { name: t.disconnect, exact: true }),
      ).toBeVisible()
      await row
        .getByRole('button', { name: `${t.showPermissions}: ${clientName}` })
        .click()
      const translatedDetails = page.getByRole('region', {
        name: `${t.scopesLabel}: ${clientName}`,
      })
      for (const scope of connectorScopes)
        await expect(
          translatedDetails.getByText(t.scopes[scope], { exact: true }),
        ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      if (locale === 'sv')
        await page.screenshot({
          path: testInfo.outputPath('mobile-expanded.png'),
          fullPage: true,
        })
      await row
        .getByRole('button', { name: `${t.hidePermissions}: ${clientName}` })
        .click()
      if (locale === 'sv')
        await page.screenshot({
          path: testInfo.outputPath('mobile.png'),
          fullPage: true,
        })
    }
    const t = dictionary(locales.at(-1)!).connectors
    await row.getByRole('button', { name: t.disconnect, exact: true }).click()
    await expect(page.getByRole('status')).toHaveText(t.disconnected)
    await expect(row).toHaveCount(0)
    await expect(page.getByText(t.none, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(t.none, { exact: true })).toBeVisible()
  } finally {
    await f.close()
  }
})
