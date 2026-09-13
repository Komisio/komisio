import { test, expect } from '@playwright/test'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
test('account map, balanced preview and downloadable SIE keep tenant boundaries', async ({
  page,
  browser,
}) => {
  const email = `p2-accounting-${randomUUID()}@example.test`
  await register(page, email, `K!${randomBytes(16).toString('hex')}`)
  const f = await p2Fixture(email)
  try {
    const item = await f.item('Synthetic accounting jacket'),
      close = randomUUID()
    await f.db.query(
      "select record_sale($1,$2,'manual',$3,'2020-01-02T10:00:00Z','SEK',$4::jsonb)",
      [
        f.tenant,
        randomUUID(),
        randomUUID(),
        JSON.stringify([{ itemId: item, priceOre: 20000 }]),
      ],
    )
    await f.db.query("select generate_day_close($1,$2,'2020-01-02')", [
      f.tenant,
      close,
    ])
    await f.commit()
    await page.goto('/intake/accounting')
    await expect(
      page.getByRole('heading', { name: 'Bokföring', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Exportera som SIE 4' }),
    ).toBeDisabled()
    const map = page.getByRole('region', { name: 'Kontoplan', exact: true })
    for (const [label, account, side] of [
      ['Bruttoförsäljning (mottagna betalningar)', '1930', 'debit'],
      ['Provision', '3010', 'credit'],
      ['Säljartillgodo (skuld till säljare)', '2890', 'credit'],
    ]) {
      await map.getByLabel(label, { exact: true }).fill(account)
      await map.getByLabel(`${label} Sida`, { exact: true }).selectOption(side)
    }
    await map.getByRole('button', { name: 'Publicera kontoplan' }).click()
    await expect(
      page.getByRole('button', { name: 'Exportera som SIE 4' }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Exportera som SIE 4' }).click()
    const link = page.getByRole('link', { name: 'Ladda ned SIE-fil' }).first()
    await expect(link).toBeVisible()
    const url = await link.getAttribute('href')
    const pending = page.waitForEvent('download')
    await link.click()
    const download = await pending
    const path = await download.path()
    expect(path).not.toBeNull()
    const text = await readFile(path!, 'utf8')
    expect(text.split(/\r?\n/).slice(0, 3)).toEqual([
      '#FLAGGA 0',
      '#FORMAT PC8',
      '#SIETYP 4',
    ])
    expect(text).toContain('#VER "A" "" 20200102')
    expect(text).toContain('#TRANS 1930 {} 200.00')
    expect(text).toContain('#TRANS 3010 {} -120.00')
    expect(text).toContain('#TRANS 2890 {} -80.00')
    const stranger = await browser.newContext()
    try {
      const response = await stranger.request.get(`http://127.0.0.1:3000${url}`)
      expect(response.status()).toBe(401)
      const otherEmail = `p2-other-${randomUUID()}@example.test`
      const otherPage = await stranger.newPage()
      await register(
        otherPage,
        otherEmail,
        `K!${randomBytes(16).toString('hex')}`,
      )
      const other = await p2Fixture(otherEmail)
      try {
        await other.commit()
        const denied = await stranger.request.get(`http://127.0.0.1:3000${url}`)
        expect(denied.status()).toBe(404)
      } finally {
        await other.close()
      }
    } finally {
      await stranger.close()
    }
    expect(
      (
        await f.db.query(
          'select count(*)::int n from accounting_exports where tenant_id=$1',
          [f.tenant],
        )
      ).rows[0].n,
    ).toBe(1)
  } finally {
    await f.close()
  }
})
