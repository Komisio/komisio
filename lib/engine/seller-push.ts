import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'

const device = {
  deviceId: z.uuid(),
  deviceSecret: z.string().regex(/^[0-9a-f]{64}$/),
}
export const pushDeviceCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('state'), ...device }),
  z
    .strictObject({
      action: z.literal('set'),
      ...device,
      requestId: z.uuid(),
      expectedRevision: z.number().int().min(0).max(2147483646),
      token: z
        .string()
        .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/)
        .nullable(),
      platform: z.enum(['ios', 'android']),
      locale: z.enum(locales),
      enabled: z.boolean(),
    })
    .refine((c) => c.enabled === (c.token !== null)),
])
export const pushDeviceState = z.strictObject({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  requestId: z.uuid().nullable(),
})
export async function executePushDevice(
  client: SupabaseClient,
  input: unknown,
) {
  const c = pushDeviceCommand.parse(input)
  if (c.action === 'state') {
    const r = await client.rpc('my_push_device', {
      p_device: c.deviceId,
      p_secret: c.deviceSecret,
    })
    if (r.error) throw r.error
    return { ok: true as const, ...pushDeviceState.parse(r.data) }
  }
  const r = await client.rpc('set_my_push_device', {
    p_device: c.deviceId,
    p_secret: c.deviceSecret,
    p_id: c.requestId,
    p_revision: c.expectedRevision,
    p_token: c.token,
    p_platform: c.platform,
    p_locale: c.locale,
    p_enabled: c.enabled,
  })
  if (r.error) throw r.error
  const saved = z
    .strictObject({
      id: z.literal(c.requestId),
      deviceId: z.literal(c.deviceId),
      revision: z.number().int().positive(),
      enabled: z.literal(c.enabled),
    })
    .parse(r.data)
  return { ok: true as const, ...saved }
}
