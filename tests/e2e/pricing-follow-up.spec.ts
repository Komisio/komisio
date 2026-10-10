import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import { evaluatePricing } from '../../lib/assistance/pricing-evaluation'
import d from '../../messages/sv.json' with { type: 'json' }

test('owner follows saved prices through reception and sale, downloads the same private cohort', async ({
  page,
  browser,
}, testInfo) => {
  const email = `pricing-follow-up-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    await f.db.query('select publish_store_profile($1,$2,null,$3::jsonb)', [
      f.tenant,
      randomUUID(),
      JSON.stringify({
        address: { street: '', postalCode: '', city: '', country: 'SE' },
        contact: { email: '', phone: '', website: '' },
        openingHours: [],
        accepts: '',
        concept: '',
        language: 'sv',
      }),
    ])
    const policy = (
      await f.db.query('select current_store_policy($1) doc', [f.tenant])
    ).rows[0].doc
    // Local synthetic historical facts; no AI provider, photos or customer messages.
    await f.db.query('reset role')
    for (const kind of ['sold', 'unsold', 'no_price', 'no_assessment']) {
      const a = kind === 'no_assessment' ? null : randomUUID(),
        submission = randomUUID(),
        session = randomUUID(),
        item = randomUUID()
      const photos = JSON.stringify([
        `${f.tenant}/${f.seller}/${randomUUID()}.jpg`,
      ])
      const output = {
        description: 'Private synthetic description',
        price: null,
        suitability: 'uncertain',
        reason: 'Private synthetic reason',
        ...(kind === 'no_price'
          ? {}
          : {
              approximatePrice: {
                from: '150.00',
                to: '250.00',
                basis: 'ai_estimate',
              },
            }),
      }
      if (a) {
        await f.db.query(
          'insert into seller_ai_attempts(id,tenant_id,seller_id,photos,context,model,created_by,created_at) values($1,$2,$3,$5::jsonb,\'{"country":"SE","currency":"SEK"}\',\'synthetic\',$4,now()-interval \'4 days\')',
          [a, f.tenant, f.seller, f.actor, photos],
        )
        await f.db.query(
          "insert into seller_ai_results(id,tenant_id,output,created_at) values($1,$2,$3,now()-interval '3 days')",
          [a, f.tenant, output],
        )
      }
      await f.db.query(
        "insert into seller_submissions(id,tenant_id,seller_id,description,photos,created_by,assistance_id,assistance_output,price_currency) values($1,$2,$3,'Private synthetic description',$7::jsonb,$4,$5,$6,'SEK')",
        [
          submission,
          f.tenant,
          f.seller,
          f.actor,
          a,
          a ? { suggestion: output, currency: 'SEK' } : null,
          photos,
        ],
      )
      await f.db.query('select create_reception_session($1,$2,$3)', [
        f.tenant,
        session,
        f.seller,
      ])
      await f.db.query(
        'insert into submission_receptions(tenant_id,submission_id,session_id,created_by) values($1,$2,$3,$4)',
        [f.tenant, submission, session, f.actor],
      )
      await f.db.query(
        "insert into items(id,tenant_id,origin_kind,origin_id,origin_revision,custody_kind,custody_id,seller_id,ownership,terms,accepted_by,accepted_at) values($1,$2,'reception_review',$3,1,'garment',$4,$5,'consignment',$6,$7,now()-interval '2 days')",
        [
          item,
          f.tenant,
          session,
          randomUUID(),
          f.seller,
          {
            commissionBasis: 'inclusive',
            commissionRatePercent: 40,
            storePolicyId: policy.id,
            storePolicyVersion: policy.version,
          },
          f.actor,
        ],
      )
      await f.db.query(
        "insert into item_prices(tenant_id,item_id,price_ore,reason,set_by,set_at) values($1,$2,20000,'accepted',$3,now()-interval '2 days')",
        [f.tenant, item, f.actor],
      )
      if (kind === 'sold')
        await f.db.query(
          "select record_sale($1,$2,'manual',$3,now()-interval '1 day','SEK',$4::jsonb)",
          [
            f.tenant,
            randomUUID(),
            `synthetic-${item}`,
            JSON.stringify([{ itemId: item, priceOre: 16000 }]),
          ],
        )
    }
    await f.commit()
    await page.goto('/intake/submissions')
    await page
      .getByRole('link', { name: d.pricingFollowUp.title, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: d.pricingFollowUp.title, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('table')).toContainText('25 %')
    await expect(page.locator('dl')).toContainText('4')
    await expect(
      page.getByText(d.pricingFollowUp.omitted.replace('{count}', '2')),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('pricing-follow-up-mobile.png'),
      fullPage: true,
    })
    await page
      .getByRole('button', { name: d.pricingFollowUp.helpLabel, exact: true })
      .click()
    await expect(page.getByText(d.pricingFollowUp.comparisonHelp)).toBeVisible()
    await page
      .getByRole('button', { name: d.pricingFollowUp.helpLabel, exact: true })
      .click()
    const downloadReady = page.waitForEvent('download')
    await page
      .getByRole('button', { name: d.pricingFollowUp.download, exact: true })
      .click()
    const download = await downloadReady
    const data = await readFile((await download.path())!, 'utf8')
    expect(data).not.toMatch(/Private synthetic|private-photo|@example.test/)
    const metrics = evaluatePricing(JSON.parse(data))
    expect(metrics.items).toBe(3)
    expect(metrics.withoutEstimate).toBe(1)
    expect(metrics.withoutSale).toBe(2)
    expect(metrics.completedSale.count).toBe(1)
    expect(metrics.completedSale.meanAbsoluteErrorPercent).toBe(25)
    expect(metrics.staffDecision.meanAbsoluteErrorPercent).toBe(0)
    await page.goto('/intake/pricing?from=2026-09-30&to=2026-09-01')
    await expect(page.locator('.stock-panel [role="alert"]')).toContainText(
      d.pricingFollowUp.periodInvalid,
    )
    await expect(
      page.getByRole('button', { name: d.pricingFollowUp.download }),
    ).toHaveCount(0)
    const staffContext = await browser.newContext()
    try {
      const staffPage = await staffContext.newPage(),
        staffEmail = `pricing-staff-${randomUUID()}@example.test`
      await register(staffPage, staffEmail, `K!${randomUUID()}`)
      await f.db.query(
        "insert into tenant_members(tenant_id,user_id,role) select $1,id,'staff' from auth.users where email=$2",
        [f.tenant, staffEmail],
      )
      await staffPage.goto('/intake/pricing')
      // Next can already have streamed 200 before the server's notFound boundary.
      await expect(
        staffPage.getByRole('heading', { name: d.notFound, exact: true }),
      ).toBeVisible()
      await expect(
        staffPage.getByRole('button', { name: d.pricingFollowUp.download }),
      ).toHaveCount(0)
    } finally {
      await staffContext.close()
    }
  } finally {
    await f.close()
  }
})
