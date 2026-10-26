import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { agreementPdfUrl } from '../../lib/documents/agreement-pdf-url'
import { register } from '../helpers/account'
import { p2Fixture } from '../helpers/p2-fixture'
import d from '../../messages/sv.json' with { type: 'json' }

test('private PDF downloads pin saved parties, version and language without accepting terms', async ({
  page,
  request,
}) => {
  const email = `agreement-pdf-${randomUUID()}@example.test`
  await register(page, email, `K!${randomUUID()}`)
  const f = await p2Fixture(email)
  try {
    const seller = randomUUID(),
      translation = randomUUID()
    await f.db.query('select register_seller($1,$2,$3,$4,$5)', [
      f.tenant,
      seller,
      'Åsa Öberg TEST',
      email,
      '',
    ])
    await f.db.query(
      'select publish_agreement_translation($1,$2,$3,$4,$5,$6)',
      [
        f.tenant,
        translation,
        f.agreement,
        'Försäljningsavtal TEST',
        'Svenska villkor med åäö och € för TEST.\n\n' +
          'Avtalstext med sidbrytning. '.repeat(220),
        'sv',
      ],
    )
    await f.commit()
    await page.goto(
      `/intake/agreements?version=${f.agreement}&translation=${translation}`,
    )
    const downloadEvent = page.waitForEvent('download')
    await page
      .getByRole('link', { name: d.agreements.pdf.download, exact: true })
      .first()
      .click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('agreement-v1-sv.pdf')
    const bytes = await readFile((await download.path())!)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.toString('latin1')).toContain('/FontFile2')
    await page.goto(`/intake/sellers/${seller}`)
    await page
      .getByRole('tab', { name: d.sellerWorkspace.terms, exact: true })
      .click()
    await page.getByLabel(d.agreements.pdf.language).selectOption(translation)
    const link = page
      .getByRole('link', { name: d.agreements.pdf.personal, exact: true })
      .filter({ visible: true })
    const path = await link.getAttribute('href')
    expect(path).toContain(`seller=${seller}`)
    expect(path).toContain(`text=${translation}`)
    const personalEvent = page.waitForEvent('download')
    await link.click()
    const personal = await personalEvent
    await personal.saveAs(test.info().outputPath('agreement-personal.pdf'))
    const response = await page.request.get(path!)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect((await request.get(path!)).status()).toBe(401)
    expect(
      (await page.request.get(path!.replace(f.tenant, randomUUID()))).status(),
    ).toBe(409)
    expect(
      (await page.request.get(path!.replace(seller, randomUUID()))).status(),
    ).toBe(404)
    expect(
      (
        await page.request.get(path!.replace(translation, randomUUID()))
      ).status(),
    ).toBe(404)
    await page.goto(`/seller/agreement?seller=${seller}&text=${translation}`)
    await expect(
      page.getByRole('link', { name: d.agreements.pdf.personal, exact: true }),
    ).toHaveCount(0)
    await expect(page.locator('.seller-agreement-workspace')).toContainText(
      'Åsa Öberg TEST',
    )
    // Existing private download bookmarks retain their original authorization.
    const portalPath = agreementPdfUrl({
      tenantId: f.tenant,
      sellerId: seller,
      agreementId: f.agreement,
      textId: translation,
      portal: true,
    })
    const portal = await page.request.get(portalPath!)
    expect(portal.status()).toBe(200)
    expect(portal.headers()['content-disposition']).toContain(
      'agreement-v1-sv.pdf',
    )
    expect(
      (await page.request.get(portalPath!.replace(seller, f.seller))).status(),
    ).toBe(403)
    expect((await request.get(portalPath!)).status()).toBe(401)
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
