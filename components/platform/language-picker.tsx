'use client'

import { useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'
import { locales, localeNames, intlLocale, type Locale } from '@/lib/i18n'

function Flag({ locale }: { locale: Locale }) {
  const horizontal = (colors: string[]) =>
    colors.map((fill, i) => (
      <rect
        key={fill}
        y={(i * 20) / 3}
        width="30"
        height={20 / 3}
        fill={fill}
      />
    ))
  const vertical = (colors: string[]) =>
    colors.map((fill, i) => (
      <rect key={fill} x={i * 10} width="10" height="20" fill={fill} />
    ))
  return (
    <svg className="language-flag" viewBox="0 0 30 20" aria-hidden="true">
      {locale === 'de' && horizontal(['#181818', '#d00', '#ffce00'])}
      {locale === 'it' && vertical(['#009246', '#fff', '#ce2b37'])}
      {locale === 'es' && (
        <>
          <rect width="30" height="20" fill="#aa151b" />
          <rect y="5" width="30" height="10" fill="#f1bf00" />
        </>
      )}
      {(['sv', 'no', 'dk', 'fi'] as Locale[]).includes(locale) && (
        <>
          <rect
            width="30"
            height="20"
            fill={
              { sv: '#006aa7', no: '#ba0c2f', dk: '#c8102e', fi: '#fff' }[
                locale as 'sv' | 'no' | 'dk' | 'fi'
              ]
            }
          />
          <path
            d="M10 0v20M0 10h30"
            stroke={
              locale === 'sv' ? '#fecc00' : locale === 'fi' ? '#002f6c' : '#fff'
            }
            strokeWidth="5"
          />
          {locale === 'no' && (
            <path d="M10 0v20M0 10h30" stroke="#00205b" strokeWidth="2.5" />
          )}
        </>
      )}
      {locale === 'en' && (
        <>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="5" />
          <path
            d="M0 0l15 10M30 20L15 10M30 0L15 10M0 20l15-10"
            stroke="#c8102e"
            strokeWidth="2"
          />
          <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="7" />
          <path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="4" />
        </>
      )}
    </svg>
  )
}

export function LanguagePicker({
  locale,
  label,
}: {
  locale: Locale
  label: string
}) {
  const router = useRouter()
  const menu = useRef<HTMLDetailsElement>(null)
  const [pending, startTransition] = useTransition()
  function close() {
    if (menu.current) menu.current.open = false
  }
  return (
    <details
      ref={menu}
      className="language-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close()
          menu.current?.querySelector('summary')?.focus()
        }
      }}
    >
      <summary aria-label={`${label}: ${localeNames[locale]}`}>
        <Flag locale={locale} />
        <span>{localeNames[locale]}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="language-options" aria-label={label}>
        {locales.map((code) => (
          <button
            key={code}
            type="button"
            lang={intlLocale(code)}
            disabled={pending}
            aria-pressed={code === locale}
            onClick={() => {
              close()
              menu.current?.querySelector('summary')?.focus()
              document.cookie = `komisio-locale=${code};path=/;max-age=31536000;SameSite=Lax`
              document.documentElement.lang = intlLocale(code)
              startTransition(() => router.refresh())
            }}
          >
            <Flag locale={code} />
            <span>{localeNames[code]}</span>
            {code === locale && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  )
}
