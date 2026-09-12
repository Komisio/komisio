import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readOperationPage } from '../lib/engine/operation-page'

export async function listScopedOperations(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
  scope: 'reception:read' | 'inspection:read',
) {
  await requireMCPIdentity(client, config, scope)
  const kind =
    scope === 'reception:read'
      ? 'publishReceptionReview'
      : 'saveInspectionDraft'
  const page = await readOperationPage(client, config.tenantId, input, kind)
  return {
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    status: page.status,
    nextBefore: page.nextBefore,
    items: page.items.map((o) => ({
      operationId: o.id,
      kind: o.kind,
      riskLevel: o.risk_level,
      status: o.status,
      createdAt: o.created_at,
      expiresAt: o.expires_at,
    })),
  }
}
