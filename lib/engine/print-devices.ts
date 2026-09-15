import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Print devices: the computer at a printer, paired with a one-time code.
// The device is its own (anonymous) auth user with the role `device`, bound
// to one printer; it can claim and complete that printer's jobs and report
// its status, nothing else. Owners and admins create codes and revoke.
export const printDevice = z.object({
  id: z.guid(),
  printerId: z.guid(),
  name: z.string(),
  version: z.string(),
  pairedAt: z.string(),
  lastSeenAt: z.string().nullable(),
  printerReachable: z.boolean().nullable(),
  lastError: z.string(),
  revokedAt: z.string().nullable(),
})
export type PrintDevice = z.infer<typeof printDevice>

export async function readPrintDevices(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('print_devices', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return z.array(printDevice).parse(r.data)
}

export const pairingCode = z.object({
  code: z.string().regex(/^[0-9A-F]{5}-[0-9A-F]{5}$/),
  expiresAt: z.string(),
})

export async function createPairingCode(
  client: SupabaseClient,
  tenantInput: string,
  printerInput: string,
) {
  const r = await client.rpc('create_print_pairing_code', {
    p_tenant: z.uuid().parse(tenantInput),
    p_printer: z.guid().parse(printerInput),
  })
  if (r.error) throw new Error(errorCode(r.error.message))
  return pairingCode.parse(r.data)
}

export async function revokePrintDevice(
  client: SupabaseClient,
  tenantInput: string,
  deviceInput: string,
) {
  const r = await client.rpc('revoke_print_device', {
    p_tenant: z.uuid().parse(tenantInput),
    p_device: z.guid().parse(deviceInput),
  })
  if (r.error) throw new Error(errorCode(r.error.message))
  return { revoked: r.data === true }
}

export const printDeviceErrorCodes = [
  'FORBIDDEN',
  'PRINTER_NOT_FOUND',
  'DEVICE_NOT_FOUND',
  'INVALID_INPUT',
] as const
export function errorCode(message: string) {
  return (
    printDeviceErrorCodes.find((c) => message.includes(c)) ?? 'REQUEST_FAILED'
  )
}

/** The Windows package for this environment: the latest release asset of the repository. */
export function printAgentDownload(
  env: Record<string, string | undefined> = process.env,
) {
  const asset =
    env.KOMISIO_ENVIRONMENT === 'production'
      ? 'KomisioPrint-win-x64.zip'
      : 'KomisioPrint-staging-win-x64.zip'
  return `https://github.com/Komisio/komisio/releases/latest/download/${asset}`
}
