import { expect, type Page } from '@playwright/test'
export async function confirmEmail(
  page: Page,
  email: string,
  subjectPart = '',
) {
  let link = ''
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          'http://127.0.0.1:54324/api/v1/messages',
        )
        if (!response.ok()) return false
        const inbox = await response.json()
        const message = inbox.messages?.find(
          (m: { To: { Address: string }[]; Subject: string }) =>
            m.To.some((t) => t.Address === email) &&
            m.Subject.includes(subjectPart),
        )
        if (!message) return false
        const detail = await (
          await page.request.get(
            `http://127.0.0.1:54324/api/v1/message/${message.ID}`,
          )
        ).json()
        const html = detail.HTML ?? detail.html ?? ''
        link = (
          html.match(/href="(http[^\"]*\/auth\/v1\/verify[^\"]*)"/)?.[1] ?? ''
        ).replaceAll('&amp;', '&')
        return !!link
      },
      { timeout: 25000 },
    )
    .toBe(true)
  await page.goto(link)
}
export async function register(
  page: Page,
  email: string,
  password: string,
  next?: string,
) {
  await page.goto(
    '/register' + (next ? `?next=${encodeURIComponent(next)}` : ''),
  )
  await page.getByLabel('E-postadress', { exact: true }).fill(email)
  await page.getByLabel('Lösenord', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Skapa konto', exact: true }).click()
  await expect(
    page.getByText('Kontrollera din e-post och följ länken'),
  ).toBeVisible()
  await confirmEmail(page, email)
}
