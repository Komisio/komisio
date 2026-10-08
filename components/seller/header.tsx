import { Brand } from '@/components/platform/brand'
import { LanguagePicker } from '@/components/platform/language-picker'
import { dictionary, type Locale } from '@/lib/i18n'
import './header.css'

export function SellerHeader({ locale }: { locale: Locale }) {
  return (
    <header className="seller-header">
      <Brand href="/seller" />
      <LanguagePicker locale={locale} label={dictionary(locale).language} />
    </header>
  )
}
