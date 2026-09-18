import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { register } from '../helpers/account'

test('reception photos can be cleared or detached without losing unsaved text', async ({
  page,
}) => {
  const run = crypto.randomUUID()
  await register(page, `remove-${run}@example.test`, `Test!${run}`)
  await page.getByLabel('Butikens namn').fill('TEST Photo removal')
  await page.getByLabel('Butikens identifierare').fill(`remove-${run}`)
  await page.getByRole('button', { name: 'Skapa min butik' }).click()
  await expect(page.getByLabel('Aktiv butik').first()).toBeVisible()
  const tenantId = await page.getByLabel('Aktiv butik').first().inputValue()
  const post = async (data: object) => {
    const response = await page.request.post('/api/intake', {
      headers: { Origin: 'http://127.0.0.1:3000' },
      data: { ...data, tenantId, requestId: crypto.randomUUID() },
    })
    expect(response.status()).toBe(200)
    return response.json()
  }
  const seller = await post({
    action: 'registerSeller',
    name: 'TEST Photo seller',
    email: '',
    phone: '00000',
  })
  const session = await post({ action: 'createReception', sellerId: seller.id })
  await page.goto(`/intake/reception/${session.id}`)
  const image = {
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: await sharp({
      create: { width: 32, height: 48, channels: 3, background: '#24649b' },
    })
      .png()
      .toBuffer(),
  }
  const input = page.getByLabel('Välj eller ta en bild')
  await expect(input).toBeEnabled()
  await input.setInputFiles(image)
  await page.getByRole('button', { name: 'Ta bort bild', exact: true }).click()
  expect(
    await input.evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(0)
  await page
    .locator('#garment-description')
    .fill('TEST text som ska finnas kvar')
  await expect(input).toBeEnabled()
  await input.setInputFiles(image)
  await page
    .getByRole('button', { name: 'Spara bild till mottagningen' })
    .click()
  await expect(page.locator('.reception-photo')).toHaveCount(1)
  await expect(page.locator('#garment-description')).toHaveValue(
    'TEST text som ska finnas kvar',
  )
  const endpoint = await page
    .locator('.reception-photo img')
    .getAttribute('src')
  await page.getByRole('button', { name: 'Ta bort bild', exact: true }).click()
  await expect(page.locator('.reception-photo')).toHaveCount(0)
  await expect(
    page.getByText('Sparad källversion 2', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('#garment-description')).toHaveValue(
    'TEST text som ska finnas kvar',
  )
  // The current reception no longer serves a detached photo; storage/history remain immutable.
  expect((await page.request.get(endpoint!)).status()).toBe(404)
  await page.reload()
  await expect(page.locator('.reception-photo')).toHaveCount(0)
  // The next upload must use revision 2, not mistake an empty draft for a new session.
  await expect(input).toBeEnabled()
  await input.setInputFiles(image)
  await page
    .getByRole('button', { name: 'Spara bild till mottagningen' })
    .click()
  await expect(page.locator('.reception-photo')).toHaveCount(1)
  await expect(
    page.getByText('Sparad källversion 3', { exact: true }),
  ).toBeVisible()
  await page.goto(`/intake/reception/${session.id}/history`)
  await expect(
    page.getByText('Application error', { exact: false }),
  ).toHaveCount(0)
  expect(
    (await page.request.get(`/api/reception/${session.id}`)).status(),
  ).toBe(200)
})
