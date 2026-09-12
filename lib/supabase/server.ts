import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseEnv } from './env'
export async function serverClient(headers: Record<string, string> = {}) {
  const store = await cookies()
  const { url, key } = supabaseEnv()
  return createServerClient(url, key, {
    global: { headers },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          )
        } catch {
          /* Server components cannot write cookies; the proxy refreshes them. */
        }
      },
    },
  })
}
