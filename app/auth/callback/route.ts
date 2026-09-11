import { NextResponse } from 'next/server'
import { serverClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/platform/validation'
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const base = process.env.NEXT_PUBLIC_APP_URL ?? url.origin
  if (code) {
    const client = await serverClient()
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext(url.searchParams.get('next')), base),
      )
  }
  const login = new URL('/login?error=callback', base)
  const destination = safeNext(url.searchParams.get('next'))
  if (destination !== '/') login.searchParams.set('next', destination)
  return NextResponse.redirect(login)
}
