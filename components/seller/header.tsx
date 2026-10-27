import { UserRound } from 'lucide-react'
import { Brand } from '@/components/platform/brand'
import { LanguagePicker } from '@/components/platform/language-picker'
import { dictionary, type Locale } from '@/lib/i18n'
import './header.css'
import { SignOut } from '@/components/platform/sign-out'
import { platformContext, hasSellerAccount } from '@/lib/platform/context'
import { RoleSwitch } from '@/components/platform/role-switch'
import { cache } from 'react'
const dualRole = cache(async () => {
  const ctx = await platformContext()
  return Boolean(ctx?.active && (await hasSellerAccount(ctx)))
})

export async function SellerHeader({
  locale,
  email,
}: {
  locale: Locale
  email?: string
}) {
  return (
    <header className="seller-header">
      <Brand href="/seller" />
      {(await dualRole()) && (
        <RoleSwitch current="seller" d={dictionary(locale)} />
      )}
      <div className="seller-header-actions">
        <LanguagePicker locale={locale} label={dictionary(locale).language} />
        {email && (
          <details className="seller-account-menu">
            <summary>
              <UserRound size={20} aria-hidden="true" />
              <span className="sr-only">
                {dictionary(locale).sellerPortalWorkspace.account}
              </span>
            </summary>
            <div>
              <p>{email}</p>
              <SignOut d={dictionary(locale)} next="/seller" />
            </div>
          </details>
        )}
      </div>
    </header>
  )
}
