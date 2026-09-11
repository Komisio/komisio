import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { commandSchema, errorCode } from '@/lib/platform/validation'
import { can } from '@/lib/platform/permissions'
import { sendInvitationEmail } from '@/lib/platform/invitation-email'

export async function POST(request: Request) {
  const requestId = randomUUID()
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    })
  // The configured origin is trusted; forwarded host headers are not.
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  if (Number(request.headers.get('content-length') ?? 0) > 10000)
    return reply({ error: 'INVALID_INPUT' }, 413)
  try {
    const context = await platformContext()
    if (!context) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (context.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 403)
    const input = commandSchema.safeParse(await request.json())
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const command = input.data
    if ('tenantId' in command && command.action !== 'select') {
      if (command.tenantId !== context.active?.id)
        return reply({ error: 'TENANT_CHANGED' }, 409)
      if (
        !can(
          context.active.role,
          command.action === 'rename' ? 'tenant.edit' : 'members.manage',
        )
      )
        return reply({ error: 'FORBIDDEN' }, 403)
    }
    let result
    let inviteUrl: string | undefined
    switch (command.action) {
      case 'create':
        result = await context.client.rpc('create_tenant', {
          p_name: command.name,
          p_slug: command.slug,
          p_request_id: command.requestId,
        })
        break
      case 'select':
        result = await context.client.rpc('set_active_tenant', {
          p_tenant: command.tenantId,
        })
        break
      case 'profile':
        result = await context.client.rpc('save_profile', {
          p_name: command.name,
          p_locale: command.locale,
        })
        break
      case 'rename':
        result = await context.client.rpc('rename_tenant', {
          p_tenant: command.tenantId,
          p_name: command.name,
        })
        break
      case 'invite': {
        const token = randomBytes(32).toString('hex')
        result = await context.client.rpc('create_invitation', {
          p_tenant: command.tenantId,
          p_email: command.email,
          p_role: command.role,
          p_token_hash: createHash('sha256').update(token).digest('hex'),
        })
        inviteUrl = `${new URL(origin).origin}/invite/${token}`
        break
      }
      case 'revoke':
        result = await context.client.rpc('revoke_invitation', {
          p_tenant: command.tenantId,
          p_invitation: command.invitationId,
        })
        break
      case 'member':
        result = await context.client.rpc('change_member', {
          p_tenant: command.tenantId,
          p_user: command.userId,
          p_role: command.role,
        })
        break
      case 'accept':
        result = await context.client.rpc('accept_invitation', {
          p_token_hash: createHash('sha256')
            .update(command.token)
            .digest('hex'),
        })
        break
    }
    if (result.error) {
      const code = errorCode(result.error.message, result.error.code)
      return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 400)
    }
    // Send only after the database has authorized and created the invitation.
    const delivery =
      command.action === 'invite' && inviteUrl
        ? await sendInvitationEmail({
            invitationId: result.data,
            email: command.email,
            inviteUrl,
            locale: context.locale,
          })
        : undefined
    return reply({
      ok: true,
      data: result.data,
      ...(inviteUrl ? { inviteUrl, delivery } : {}),
    })
  } catch {
    // Never log request bodies, passwords or invitation tokens.
    console.error('Platform request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
