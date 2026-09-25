'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
/** On-demand native dialog gives the reference and code the full mobile width. */
export function HandoverCode({
  tenantId,
  sellerId,
  reference,
  d,
}: {
  tenantId: string
  sellerId: string
  reference: string
  d: Dictionary['sellerPortal']
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false)
  const src =
    '/api/seller/handovers/code?' +
    new URLSearchParams({ tenant: tenantId, seller: sellerId, reference })
  return (
    <div style={{ margin: '0.75rem 0' }}>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setFailed(false)
          setOpen(true)
          dialog.current?.showModal()
        }}
      >
        {d.showHandoverCode}
      </Button>
      <dialog
        ref={dialog}
        aria-label={reference}
        onClose={() => {
          setOpen(false)
          setFailed(false)
        }}
        style={{
          width: 'min(288px, calc(100% - 2rem))',
          margin: 'auto',
          inset: 0,
          maxHeight: 'calc(100% - 2rem)',
          padding: '1rem',
          border: '1px solid var(--line)',
          borderRadius: '1rem',
          background: '#fff',
          color: 'var(--ink)',
        }}
      >
        {open && (
          <h2
            id={'code-title-' + reference}
            style={{ margin: '0 0 0.5rem', textAlign: 'center' }}
          >
            {reference}
          </h2>
        )}
        {open &&
          (failed ? (
            <p role="status">{d.handoverCodeError}</p>
          ) : (
            <>
              {/* The authenticated SVG is deliberately loaded on demand without an image proxy. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={d.handoverCodeAlt.replace('{ref}', reference)}
                width={240}
                height={240}
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: 240,
                  height: 'auto',
                  margin: 'auto',
                  background: '#fff',
                }}
                onError={() => setFailed(true)}
              />
              <p>{d.handoverCodeHint}</p>
            </>
          ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => dialog.current?.close()}
          style={{ width: '100%' }}
        >
          {d.hideHandoverCode}
        </Button>
      </dialog>
    </div>
  )
}
