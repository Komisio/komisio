import { NextResponse } from 'next/server'
import {
  appOrigin,
  connectorsEnabled,
  protectedResourceMetadata,
} from '@/lib/engine/connectors'
import { publicJson, publicPreflight } from '@/lib/http/public-json'

/** RFC 9728, at the plain path and at the path-suffixed form for /api/mcp. */
export async function GET() {
  if (!connectorsEnabled()) return NextResponse.json({}, { status: 404 })
  return publicJson(protectedResourceMetadata(appOrigin()))
}
export async function OPTIONS() {
  return publicPreflight()
}
