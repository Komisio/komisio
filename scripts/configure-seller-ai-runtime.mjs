import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export async function configureSellerAIRuntime(
  target,
  env = process.env,
  request = fetch,
) {
  if (
    !['staging', 'production'].includes(target) ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'Komisio/komisio' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !==
      (target === 'production' ? 'workflow_dispatch' : 'push')
  )
    throw new Error(
      'Seller AI configuration requires the protected main workflow',
    )
  if (
    !/^[a-z]{20}$/.test(env.SUPABASE_PROJECT_ID ?? '') ||
    !env.SUPABASE_ACCESS_TOKEN ||
    !/^[a-f0-9]{64}$/i.test(env.KOMISIO_SELLER_AI_SERVER_KEY ?? '')
  )
    throw new Error('Missing seller AI deployment configuration')
  const hash = createHash('sha256')
    .update(env.KOMISIO_SELLER_AI_SERVER_KEY)
    .digest('hex')
  const response = await request(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `insert into komisio_private.seller_ai_runtime(singleton,key_hash) values(true,'${hash}') on conflict(singleton) do update set key_hash=excluded.key_hash returning key_hash='${hash}' as verified`,
      }),
      signal: AbortSignal.timeout(30000),
    },
  )
  if (!response.ok)
    throw new Error(`Seller AI configuration failed (${response.status})`)
  const result = await response.json()
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0].verified !== true
  )
    throw new Error('Seller AI configuration verification failed')
  console.log(`Seller AI server verifier configured for ${target}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await configureSellerAIRuntime(process.argv[2])
