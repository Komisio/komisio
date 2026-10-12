'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import { useContext, type FormHTMLAttributes } from 'react'
import { WorkspaceSearchTransition } from '@/components/ui/workspace-tabs'
import { useRouter } from './use-working-router'
import { useConfirmNavigation } from './navigation-warning'

type SearchFormProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  'action' | 'method'
> & { action?: string }

/** Search fields reflect the committed URL, including clearing and history. */
export function WorkingForm(props: SearchFormProps) {
  const pathname = usePathname()
  const params = useSearchParams()
  return <SearchForm key={`${pathname}?${params.toString()}`} {...props} />
}

/** Native GET encoding and tab-adjusted actions, with tracked client navigation. */
function SearchForm({
  children,
  action = '',
  onSubmit,
  ...props
}: SearchFormProps) {
  const confirm = useConfirmNavigation()
  const router = useRouter()
  const startSearch = useContext(WorkspaceSearchTransition)
  return (
    <form
      {...props}
      action={action}
      method="get"
      onSubmit={(event) => {
        onSubmit?.(event)
        if (event.defaultPrevented) return
        const form = event.currentTarget
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        const target = submitter?.getAttribute('formtarget') ?? form.target
        const method = submitter?.getAttribute('formmethod') ?? form.method
        const destination = new URL(
          submitter?.getAttribute('formaction') ?? form.action,
          window.location.href,
        )
        if (
          method.toLowerCase() !== 'get' ||
          (target && target !== '_self') ||
          destination.origin !== window.location.origin
        )
          return
        event.preventDefault()
        if (!confirm()) return
        const fields = new FormData(form, submitter)
        destination.search = new URLSearchParams(
          [...fields].map(([name, value]) => [
            name,
            typeof value === 'string' ? value : value.name,
          ]),
        ).toString()
        const navigate = () =>
          router.push(
            destination.pathname + destination.search + destination.hash,
          )
        // A tab's history update must not cancel the pending search navigation.
        if (startSearch) startSearch(navigate)
        else navigate()
      }}
    >
      {children}
    </form>
  )
}
