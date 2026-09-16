import { anonClient } from '@/lib/engine/connectors'
import { readPublicPricing } from '@/lib/engine/ai-credits'
import { publicJson, publicPreflight } from '@/lib/http/public-json'

/**
 * The offer in numbers, for the marketing site: included credits, the pack
 * price, the measured estimate of items per month, and the anonymous figures
 * of the stores the host chose to show. No identities, no session.
 */
export async function GET() {
  try {
    return publicJson(
      await readPublicPricing(anonClient()),
      200,
      'public, max-age=600',
    )
  } catch {
    return publicJson({ error: 'NOT_AVAILABLE' }, 503, 'no-store')
  }
}
export async function OPTIONS() {
  return publicPreflight()
}
