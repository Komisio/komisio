import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { readFileSync } from 'node:fs'
import type { Dictionary } from '../../lib/i18n'

test('agreement tab summarizes effective settings in eight languages without rewriting legal text', async ({
  page,
}, testInfo) => {
  const email = `summary-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = (
      await f.db.query('select register_seller($1,$2,$3,$4,$5) id', [
        f.tenant,
        randomUUID(),
        'Actual synthetic seller',
        email,
        '',
      ])
    ).rows[0].id
    await f.db.query('select publish_seller_terms($1,$2,$3,null,$4,$5,$6)', [
      f.tenant,
      randomUUID(),
      seller,
      'exclusive',
      12.5,
      'PRIVATE STAFF TERMS',
    ])
    await f.db.query(
      `select publish_store_policy($1,$2,(current_store_policy($1)->>'id')::uuid,(current_store_policy($1)->'policy')||'{"consignmentPeriod":{"months":2,"collectionDays":14},"endOfPeriodAction":"charity"}')`,
      [f.tenant, randomUUID()],
    )
    const literal = 'Literal terms: <b>{sellerName}</b>. No substitutions.'
    await f.db.query(
      "select publish_seller_agreement($1,$2,$3,'Synthetic agreement',$4,'en',false)",
      [f.tenant, randomUUID(), f.agreement, literal],
    )
    await f.commit()
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`/seller?seller=${seller}#seller-workspace-agreement`)
    const summary = page.locator('.seller-agreement-workspace')
    for (const locale of ['sv', 'en', 'no', 'dk', 'fi', 'de', 'es', 'it']) {
      const d: Dictionary = JSON.parse(
          readFileSync(
            new URL('../../messages/' + locale + '.json', import.meta.url),
            'utf8',
          ),
        ),
        c = d.sellerAgreementSummary
      await page.context().addCookies([
        {
          name: 'komisio-locale',
          value: locale,
          url: new URL(page.url()).origin,
        },
      ])
      await page.reload()
      const tab = page.getByRole('tab', {
        name: d.sellerPortalWorkspace.agreement + ' — ' + c.needsApproval,
        exact: true,
      })
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await expect(summary).toContainText('Actual synthetic seller')
      await expect(summary).toContainText(
        c.commission
          .replace(
            '{rate}',
            new Intl.NumberFormat(locale === 'dk' ? 'da' : locale).format(12.5),
          )
          .replace('{basis}', d.sellerTerms.exclusive),
      )
      await expect(summary).toContainText(c.months.replace('{months}', '2'))
      await expect(summary).toContainText(c.collection.replace('{days}', '14'))
      await expect(summary).not.toContainText(c.charity)
      await expect(page.getByText('PRIVATE STAFF TERMS')).toHaveCount(0)
      await expect(
        page.getByRole('button', {
          name: d.sellerAgreement.accept,
          exact: true,
        }),
      ).toBeVisible()
      const full = page.getByTestId('seller-agreement-full')
      await expect(full).not.toHaveAttribute('open', '')
      await full.locator('summary').click()
      await expect(page.locator('.seller-agreement-body')).toHaveText(literal)
      await expect(page.locator('.seller-agreement-body b')).toHaveCount(0)
      await expect(
        page.getByRole('link', {
          name: d.agreements.pdf.personal,
          exact: true,
        }),
      ).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.screenshot({
      path: testInfo.outputPath('agreement-summary-320.png'),
      fullPage: true,
    })
    expect(
      (
        await f.db.query(
          'select count(*)::int n from seller_agreement_evidence where seller_id=$1',
          [seller],
        )
      ).rows[0].n,
    ).toBe(0)
  } finally {
    await f.close()
  }
})
