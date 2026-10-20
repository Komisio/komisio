import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../i18n'
import { supportPage } from '../help/support'
import { isHelpTopic } from '../help/topics'

export const helpFeedbackInput = z.strictObject({
  tenantId: z.uuid(),
  slug: z.string().max(80).refine(isHelpTopic),
  locale: z.enum(locales),
  page: z.string().startsWith('/').max(2000),
  helpful: z.boolean(),
  comment: z.string().max(1000).nullable(),
})
export async function submitHelpFeedback(
  client: SupabaseClient,
  input: unknown,
) {
  const value = helpFeedbackInput.parse(input)
  const page = new URL(value.page, 'https://help.invalid')
  const result = await client.rpc('submit_help_feedback', {
    p_tenant: value.tenantId,
    p_slug: value.slug,
    p_locale: value.locale,
    p_page: supportPage(
      page.pathname,
      page.searchParams.get('view'),
      page.searchParams.get('tab'),
    ),
    p_helpful: value.helpful,
    p_comment: value.comment?.trim() || null,
  })
  if (result.error) throw new Error(result.error.message)
}
