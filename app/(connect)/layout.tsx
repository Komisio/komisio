import { Brand } from '@/components/platform/brand'

/** The consent page stands outside the store shell: it must reach a signed-out person with its query intact. */
export default function ConnectLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="onboarding">
      <Brand />
      {children}
    </main>
  )
}
