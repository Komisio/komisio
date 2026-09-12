import { z } from 'zod'
export type ReceptionAIConfig = { key: string; model: string }
/** No generic API key, wildcard store or client-supplied provider URL. */
export function receptionAIConfig(
  tenantId: string,
  env: Record<string, string | undefined> = process.env,
): ReceptionAIConfig | null {
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai') return null
  const model = env.KOMISIO_RECEPTION_AI_MODEL?.trim(),
    key = env.KOMISIO_RECEPTION_AI_KEY?.trim()
  const tenants =
    env.KOMISIO_RECEPTION_AI_TENANTS?.split(',').map((s) => s.trim()) ?? []
  if (
    !key ||
    !model ||
    !/^[a-zA-Z0-9._:-]{1,100}$/.test(model) ||
    !tenants.length ||
    !tenants.every((id) => z.uuid().safeParse(id).success) ||
    !tenants.includes(tenantId)
  )
    return null
  return { key, model }
}
