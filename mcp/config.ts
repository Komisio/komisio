import { z } from 'zod'
const scope = z.enum(['reception:read', 'reception:preview'])
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
  token: z.string().min(1),
  tenantId: z.uuid(),
  scopes: z.array(scope).min(1).max(2),
})
export type MCPConfig = z.infer<typeof mcpConfig>
export function readMCPConfig(
  env: Record<string, string | undefined> = process.env,
): MCPConfig {
  return mcpConfig.parse({
    url: env.KOMISIO_MCP_SUPABASE_URL,
    key: env.KOMISIO_MCP_PUBLISHABLE_KEY,
    token: env.KOMISIO_MCP_ACCESS_TOKEN,
    tenantId: env.KOMISIO_MCP_TENANT_ID,
    scopes: env.KOMISIO_MCP_SCOPES?.split(',').map((s) => s.trim()),
  })
}
