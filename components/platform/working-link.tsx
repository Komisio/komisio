'use client'
import NextLink, { useLinkStatus } from 'next/link'
import type { ComponentProps } from 'react'
import { useWorkActivity } from './work-activity'

function LinkActivity() {
  const { pending } = useLinkStatus()
  useWorkActivity(pending)
  return null
}

/** Next owns cancellation, same-page anchors, downloads and modifier clicks. */
export default function WorkingLink({
  children,
  ...props
}: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props}>
      {children}
      <LinkActivity />
    </NextLink>
  )
}
