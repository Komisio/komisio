import { NextResponse } from 'next/server'
import {
  appOrigin,
  connectorsEnabled,
  oauthMetadata,
} from '@/lib/engine/connectors'
import { publicJson, publicPreflight } from '@/lib/http/public-json'

/** RFC 8414: Komisio is the authorization server for its own MCP endpoint. */
export async function GET() {
  if (!connectorsEnabled()) return NextResponse.json({}, { status: 404 })
  return publicJson(oauthMetadata(appOrigin()))
}
export async function OPTIONS() {
  return publicPreflight()
}
