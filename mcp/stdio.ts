import { createClient } from '@supabase/supabase-js'
import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio'
import { readMCPConfig } from './config'
import { createReceptionMCP } from './server'
try {
  const config = readMCPConfig()
  const client = createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${config.token}` },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(10000),
          ]),
        }),
    },
  })
  serveStdio(() => createReceptionMCP(client, config), {
    transport: new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 131072,
    }),
    onerror: () => console.error('Komisio MCP transport failed.'),
  })
} catch {
  console.error(
    'Komisio MCP could not start. Check its dedicated configuration; no credentials are logged.',
  )
  process.exitCode = 1
}
