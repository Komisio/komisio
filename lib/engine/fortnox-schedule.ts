import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const sendTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const fortnoxSchedule = z.object({
  id: z.uuid().nullable(),
  time: sendTime,
})
export type FortnoxSchedule = z.infer<typeof fortnoxSchedule>
export const saveFortnoxScheduleInput = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  previousId: z.uuid().nullable(),
  time: sendTime,
})
export async function readFortnoxSchedule(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('fortnox_send_schedule', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORTNOX_READ_FAILED')
  return fortnoxSchedule.parse(r.data)
}
export async function saveFortnoxSchedule(
  client: SupabaseClient,
  input: unknown,
) {
  const c = saveFortnoxScheduleInput.parse(input)
  const r = await client.rpc('save_fortnox_send_schedule', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_previous: c.previousId,
    p_time: c.time,
  })
  if (r.error)
    throw new Error(
      [
        'FORBIDDEN',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'FORTNOX_SCHEDULE_CHANGED',
      ].includes(r.error.message)
        ? r.error.message
        : 'REQUEST_FAILED',
    )
  const schedule = fortnoxSchedule.parse(r.data)
  if (schedule.id !== c.requestId || schedule.time !== c.time)
    throw new Error('REQUEST_FAILED')
  return { ok: true, schedule }
}
