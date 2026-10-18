import { AutoMailSettings } from '@/components/seller-registration/auto-mail-settings'
import { readAutoMailSettings } from '@/lib/engine/store-mail'
import { notFound } from 'next/navigation'
import { toSVG } from '@bwip-js/generic'
import Link from '@/components/platform/working-link'
import { RegistrationSettingsForm } from '@/components/seller-registration/settings'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readRegistrationSettings } from '@/lib/engine/seller-registration'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import '@/components/seller-registration/registration.css'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.selfRegistration.title)
export default async function RegistrationSettingsPage() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform(),
    active = ctx.active!
  if (!['owner', 'admin', 'staff'].includes(active.role)) notFound()
  const d = dictionary(ctx.locale).selfRegistration
  const current = await readRegistrationSettings(ctx.client, active.id)
  const mailSettings = await readAutoMailSettings(ctx.client, active.id)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  const url =
    current.token && origin
      ? new URL(`/join/${current.token}`, origin).toString()
      : null
  const qr = url
    ? 'data:image/svg+xml;base64,' +
      Buffer.from(
        toSVG({
          bcid: 'qrcode',
          text: url,
          scale: 4,
          padding: 8,
          backgroundcolor: 'FFFFFF',
        }),
      ).toString('base64')
    : null
  return (
    <div className="registration-page">
      <Link href="/settings">{d.back}</Link>
      <h1>{d.title}</h1>
      <AutoMailSettings
        key={mailSettings.id ?? 'default'}
        tenantId={active.id}
        current={mailSettings}
        canEdit={active.role !== 'staff'}
        d={dictionary(ctx.locale)}
      />
      <RegistrationSettingsForm
        key={current.id ?? 'default'}
        tenantId={active.id}
        current={current}
        canEnable={active.role !== 'staff'}
        url={url}
        qr={qr}
        d={d}
      />
    </div>
  )
}
