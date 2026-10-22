import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { boundedJson } from '@/lib/http/bounded-json'
import { createPairingCode, readPrintDevices } from './print-devices'
import { readPrinters } from './printing'

export const managedWeblinkCommand = z.strictObject({
  action: z.enum(['connect', 'configuration']),
  tenantId: z.uuid(),
  printerId: z.uuid(),
})
const status = z.strictObject({
  state: z.enum(['absent', 'pending', 'ready', 'held']),
  deviceId: z.uuid().nullable(),
})
export const managedWeblinkErrors = [
  'PRINTER_NOT_FOUND',
  'PRINT_MANAGED_PAUSE_FIRST',
  'PRINT_MANAGED_REVIEW_REQUIRED',
  'PRINT_MANAGED_UNAVAILABLE',
  'PRINT_MANAGED_DEVICE_CONFLICT',
  'FORBIDDEN',
] as const

export function managedWeblinkConfigured(env = process.env) {
  try {
    const url = new URL(env.KOMISIO_WEBLINK_MANAGEMENT_URL ?? '')
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      /^[A-Za-z0-9_-]{43}$/.test(env.KOMISIO_WEBLINK_MANAGEMENT_SECRET ?? '')
    )
  } catch {
    return false
  }
}

/** The owner's existing RLS session authorizes the printer and one-use pairing.
 * Only the server talks to its environment's gateway. No endpoint, credentials,
 * device identity or tenant membership can be supplied by the browser.
 */
export async function manageHostedWeblink(
  client: SupabaseClient,
  input: z.input<typeof managedWeblinkCommand>,
  { env = process.env, fetchImpl = fetch } = {},
) {
  const c = managedWeblinkCommand.parse(input)
  if (!managedWeblinkConfigured(env))
    throw new Error('PRINT_MANAGED_UNAVAILABLE')
  async function authorize(device: string | null = null) {
    const r = await client.rpc('authorize_weblink_setup', {
      p_tenant: c.tenantId,
      p_printer: c.printerId,
      p_device: device,
    })
    if (r.error || r.data !== true) throw new Error('FORBIDDEN')
  }
  await authorize()
  const printers = await readPrinters(client, c.tenantId)
  const printer = printers.find(
    (p) => p.id === c.printerId && p.transport === 'weblink',
  )
  if (!printer) throw new Error('PRINTER_NOT_FOUND')
  const devices = await readPrintDevices(client, c.tenantId)
  if (!devices) throw new Error('PRINT_MANAGED_UNAVAILABLE')
  const owned = devices.filter((d) => d.printerId === c.printerId)
  async function request(action: string, extra: object = {}) {
    try {
      const response = await fetchImpl(
        new URL(`/manage/${action}`, env.KOMISIO_WEBLINK_MANAGEMENT_URL),
        {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(45000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.KOMISIO_WEBLINK_MANAGEMENT_SECRET}`,
          },
          body: JSON.stringify({
            tenantId: c.tenantId,
            printerId: c.printerId,
            ...extra,
          }),
        },
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('unavailable')
      }
      return await boundedJson(response, 24000)
    } catch {
      throw new Error('PRINT_MANAGED_REVIEW_REQUIRED')
    }
  }
  const current = status.parse(await request('lookup'))
  const device = current.deviceId
    ? owned.find((d) => d.id === current.deviceId)
    : null
  if (c.action === 'configuration') {
    if (!device || device.revokedAt)
      throw new Error('PRINT_MANAGED_DEVICE_CONFLICT')
    const result = z
      .strictObject({
        deviceId: z.uuid(),
        configuration: z.string().min(1).max(20000),
      })
      .parse(await request('configuration', { deviceId: device.id }))
    if (result.deviceId !== device.id)
      throw new Error('PRINT_MANAGED_DEVICE_CONFLICT')
    await authorize(device.id)
    return { ok: true, ...result }
  }
  if (current.state === 'ready' && device && !device.revokedAt) {
    await authorize(device.id)
    return { ok: true, deviceId: device.id }
  }
  if (current.deviceId && !device)
    throw new Error('PRINT_MANAGED_DEVICE_CONFLICT')
  if (current.state === 'held' && !device?.revokedAt)
    throw new Error('PRINT_MANAGED_REVIEW_REQUIRED')
  if (printer.active) throw new Error('PRINT_MANAGED_PAUSE_FIRST')
  const live = owned.some((d) => !d.revokedAt)
  if (live && current.state !== 'pending')
    throw new Error('PRINT_MANAGED_DEVICE_CONFLICT')
  const pairing = live
    ? null
    : await createPairingCode(client, c.tenantId, c.printerId)
  const prepared = status.parse(
    await request('enroll', {
      name: printer.name,
      ...(pairing ? { code: pairing.code } : {}),
      ...(device?.revokedAt ? { replaceDeviceId: device.id } : {}),
    }),
  )
  if (prepared.state !== 'ready' || !prepared.deviceId)
    throw new Error('PRINT_MANAGED_REVIEW_REQUIRED')
  // Re-read database evidence, including revocation concurrent with provisioning.
  const verified = (await readPrintDevices(client, c.tenantId))?.find(
    (d) =>
      d.id === prepared.deviceId && d.printerId === c.printerId && !d.revokedAt,
  )
  if (!verified) throw new Error('PRINT_MANAGED_DEVICE_CONFLICT')
  await authorize(verified.id)
  return { ok: true, deviceId: verified.id }
}
