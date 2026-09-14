import type { SupabaseClient } from '@supabase/supabase-js'
import { readEconomySummary } from './economy'
import { readOperationQueue } from './operations'
import { openDays, readReconciliation } from './reconciliation'
import { currentMonthPeriod } from './economy'

// The start page's numbers: today's sales, what waits for a person, and
// what the store owes its sellers. Every part is read under the person's
// own session and tolerates a missing read (deploy gap) by showing nothing.
export type Overview = {
  today: { salesCount: number; grossOre: number; currency: string } | null
  openProposals: number | null
  attentionDays: number | null
  openPayouts: { count: number; amountOre: number } | null
  owedOre: number | null
}

export function localToday(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

export async function readOverview(
  client: SupabaseClient,
  tenantId: string,
): Promise<Overview> {
  const today = localToday()
  const [economy, queue, recon] = await Promise.all([
    readEconomySummary(client, tenantId, { from: today, to: today }).catch(
      () => null,
    ),
    readOperationQueue(client, tenantId).catch(() => null),
    readReconciliation(client, tenantId, currentMonthPeriod()).catch(
      () => null,
    ),
  ])
  return {
    today: economy
      ? {
          salesCount: economy.totals.salesCount,
          grossOre: economy.totals.grossOre,
          currency: economy.currency,
        }
      : null,
    openProposals: queue
      ? queue.filter((o) => o.status === 'open').length
      : null,
    attentionDays: recon ? openDays(recon).length : null,
    openPayouts: economy ? economy.openPayouts : null,
    owedOre: economy ? economy.liability.owedOre : null,
  }
}
