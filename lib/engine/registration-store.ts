import type { SupabaseClient } from '@supabase/supabase-js'
import { registrationCommand, internalNote } from './registration'
import { readAttributeVocabulary } from './attributes'
export async function executeRegistration(
  client: SupabaseClient,
  input: unknown,
) {
  const c = registrationCommand.parse(input)
  const result =
    c.action === 'settings'
      ? await client.rpc('publish_registration_settings', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_expected: c.expectedId,
          p_settings: c.settings,
        })
      : await client.rpc('save_item_internal_note', {
          p_tenant: c.tenantId,
          p_id: c.requestId,
          p_expected: c.expectedId,
          p_kind: c.kind,
          p_subject: c.subjectId,
          p_note: c.note,
        })
  if (result.error) throw Error(result.error.message)
  if (result.data !== c.requestId) throw Error('REQUEST_FAILED')
  return {
    id: c.requestId,
    ...(c.action === 'settings'
      ? { vocabulary: await readAttributeVocabulary(client, c.tenantId) }
      : {}),
  }
}
export async function readInternalNote(
  client: SupabaseClient,
  tenantId: string,
  kind: 'item' | 'reception' | 'purchase',
  subjectId: string,
) {
  const result = await client.rpc('item_internal_note', {
    p_tenant: tenantId,
    p_kind: kind,
    p_subject: subjectId,
  })
  if (result.error) throw Error('Unable to read internal note')
  return internalNote.parse(result.data)
}
