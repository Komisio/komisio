import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '../i18n'
import { factCommunicationId, sendSellerCommunication } from './dispatch'
export async function notifySubmissionReview(
  client: SupabaseClient,
  store: { tenantId: string; storeName: string; locale: Locale },
  reviewId: string,
  manual = false,
) {
  try {
    const review = await client
      .from('seller_submission_reviews')
      .select('submission_id')
      .eq('tenant_id', store.tenantId)
      .eq('id', reviewId)
      .single()
    if (review.error) return 'failed'
    const proposal = await client
      .from('seller_submissions')
      .select('seller_id')
      .eq('tenant_id', store.tenantId)
      .eq('id', review.data.submission_id)
      .single()
    if (proposal.error) return 'failed'
    if (!manual) {
      const policy = await client.rpc('current_store_policy', {
        p_tenant: store.tenantId,
      })
      if (policy.error) return 'failed'
      if (policy.data?.policy?.automaticSellerNotifications !== true)
        return 'manual'
      const allowed = await client.rpc('allow_automatic_seller_email', {
        p_tenant: store.tenantId,
        p_seller: proposal.data.seller_id,
        p_fact: reviewId,
      })
      if (allowed.error) return 'failed'
      if (allowed.data !== true) return 'manual'
    }
    const result = await sendSellerCommunication(client, {
      ...store,
      requestId: factCommunicationId('submission_review', reviewId),
      sellerId: proposal.data.seller_id,
      kind: 'message',
      referenceId: null,
      freeText: '',
      submissionReviewId: reviewId,
    })
    return result.ok ? result.delivery : 'failed'
  } catch {
    return 'failed'
  }
}
