import { test, expect } from '@playwright/test'

for (const [path, button] of [
  ['/register', 'Skapa konto'],
  ['/login', 'Logga in'],
  ['/reset-password', 'Skicka återställningslänk'],
]) {
  test(`auth controls wait for client readiness on ${path}`, async ({
    page,
  }) => {
    let release!: () => void
    const scripts = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, async (route) => {
      await scripts
      await route.continue()
    })
    try {
      await page.goto(path, { waitUntil: 'commit' })
      const email = page.getByLabel('E-postadress', { exact: true })
      const submit = page.getByRole('button', { name: button, exact: true })
      await expect(email).toBeVisible()
      await expect(page.locator('form')).toHaveAttribute('method', 'post')
      await expect(email).toBeDisabled({ timeout: 2000 })
      await expect(submit).toBeDisabled()
      if (path !== '/reset-password')
        await expect(
          page.getByLabel('Lösenord', { exact: true }),
        ).toBeDisabled()
      release()
      await expect(email).toBeEnabled()
      await expect(submit).toBeEnabled()
      await email.fill('readiness@example.test')
      await expect(email).toHaveValue('readiness@example.test')
      expect(new URL(page.url()).search).toBe('')
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
}
