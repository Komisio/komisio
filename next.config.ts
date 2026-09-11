import type { NextConfig } from 'next'
const config: NextConfig = {
  // Vercel packages its own functions; standalone is for self-hosting.
  output: process.env.VERCEL === '1' ? undefined : 'standalone',
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}
export default config
