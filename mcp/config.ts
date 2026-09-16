import { z } from 'zod'
const scope = z.enum([
  'reception:read',
  'reception:preview',
  'reception:photos',
  'reception:propose',
  'inspection:read',
  'inspection:preview',
  'inspection:propose',
  'items:read',
  'items:propose',
  'economy:read',
  'sales:read',
  'sales:propose',
  'ledger:propose',
  'lifecycle:propose',
  'communications:propose',
  'payouts:propose',
  'accounting:read',
  'accounting:propose',
  'store:read',
  'store:propose',
])
export type MCPScope = z.infer<typeof scope>
export const mcpConfig = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  }),
  key: z.string().min(1),
  // A local host supplies the person's access token; a hosted grant carries
  // the person's id instead, and every call runs through connector_call.
  token: z.string().min(1).optional(),
  userId: z.uuid().optional(),
  hosted: z.boolean().default(false),
  tenantId: z.uuid(),
  scopes: z
    .array(scope)
    .min(1)
    .max(20)
    .refine((s) => new Set(s).size === s.length),
})
/**
 * Tools the hosted connector does not register: their engine reads use table
 * or storage access, which a connector token cannot do. They stay local-only
 * until those reads become SQL functions (docs/HOSTED-MCP.md).
 */
export const hostedExcludedTools = new Set([
  'komisio_read_inspection_operation',
  'komisio_read_reception_operation',
  'komisio_preview_inspection',
  'komisio_prepare_inspection_reception',
  'komisio_list_bags',
  'komisio_read_inspection',
  'komisio_read_reception_history',
  'komisio_list_receptions',
  'komisio_read_reception',
  'komisio_preview_reception',
  'komisio_propose_reception_review',
  'komisio_read_reception_photo',
  'komisio_propose_price_change',
])
export function hostedToolAllowed(name: string) {
  return !hostedExcludedTools.has(name)
}
export type MCPConfig = z.infer<typeof mcpConfig>
export function readMCPConfig(
  env: Record<string, string | undefined> = process.env,
): MCPConfig {
  const parsed = mcpConfig.parse({
    url: env.KOMISIO_MCP_SUPABASE_URL,
    key: env.KOMISIO_MCP_PUBLISHABLE_KEY,
    token: env.KOMISIO_MCP_ACCESS_TOKEN,
    tenantId: env.KOMISIO_MCP_TENANT_ID,
    scopes: env.KOMISIO_MCP_SCOPES?.split(',').map((s) => s.trim()),
  })
  if (!parsed.token) throw new Error('KOMISIO_MCP_ACCESS_TOKEN is required')
  if (parsed.scopes.length > 9)
    throw new Error('At most nine scopes for a local host')
  return parsed
}
