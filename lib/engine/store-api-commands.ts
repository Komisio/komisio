import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  recordSchemas,
  requestStatus,
  type StoreCommand,
} from './store-api-contract'

export async function submitStoreCommand(
  client: SupabaseClient,
  secret: string,
  replay: string,
  action: StoreCommand,
  subject: string | null,
  body: object,
) {
  const r = await client.rpc('write_store_api_record', {
    p_secret: secret,
    p_replay: replay,
    p_action: action,
    p_subject: subject,
    p_body: body,
  })
  if (r.error) throw new Error(r.error.message)
  return z
    .union([
      requestStatus.extend({ status: z.enum(['executed', 'failed']) }),
      z.object({ id: z.uuid(), status: z.literal('review') }),
    ])
    .parse(r.data)
}
export async function readStoreRequest(
  client: SupabaseClient,
  secret: string,
  id: string,
) {
  const r = await client.rpc('store_api_request_status', {
    p_secret: secret,
    p_id: id,
  })
  if (r.error) throw new Error(r.error.message)
  return requestStatus.nullable().parse(r.data)
}
export async function readStoreRecords(
  client: SupabaseClient,
  secret: string,
  resource: keyof typeof recordSchemas,
  id: string | null,
  limit: number,
  after: string | null,
) {
  const r = await client.rpc('store_api_records', {
    p_secret: secret,
    p_resource: resource,
    p_limit: limit,
    p_after: after,
    p_id: id,
  })
  if (r.error) throw new Error(r.error.message)
  return z
    .object({
      records: recordSchemas[resource].array(),
      nextCursor: z.guid().nullable(),
    })
    .parse(r.data)
}
