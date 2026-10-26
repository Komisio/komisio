import { Brand } from '@/components/platform/brand'
import { LanguagePicker } from '@/components/platform/language-picker'
import { dictionary, type Locale } from '@/lib/i18n'
import './header.css'
import { platformContext, hasSellerAccount } from '@/lib/platform/context'
import { RoleSwitch } from '@/components/platform/role-switch'
import { cache } from 'react'
const dualRole = cache(async () => {
  const ctx = await platformContext()
  return Boolean(ctx?.active && (await hasSellerAccount(ctx)))
})

export async function SellerHeader({ locale }: { locale: Locale }) {
  return (
    <header className="seller-header">
      <Brand href="/seller" />
      {(await dualRole()) && (
        <RoleSwitch current="seller" d={dictionary(locale)} />
      )}
      <LanguagePicker locale={locale} label={dictionary(locale).language} />
    </header>
  )
}
