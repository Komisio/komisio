'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import {
  Barcode,
  ChevronDown,
  Handshake,
  ImagePlus,
  Printer,
  Store,
} from 'lucide-react'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { EventTime } from '@/components/ui/event-time'
import type { Dictionary, Locale } from '@/lib/i18n'
import type { DirectoryItem } from '@/lib/engine/item-directory'
import { useItemQuickEdit } from './use-item-quick-edit'
import { itemPhotoUrl } from './item-photo-preview'
import './inventory-edit.css'
import './item-detail-workspace.css'

export function ItemDetailWorkspace({
  item,
  tenantId,
  write,
  types,
  groups,
  categories,
  d,
  locale,
  reference,
  price,
  metadata,
  photos,
  sync,
  history,
  terms,
  printing,
  saleHref,
  markSoldHref,
}: {
  item: DirectoryItem
  tenantId: string
  write: boolean
  types: { id: string; name: string }[]
  groups: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  d: Dictionary
  locale: Locale
  reference: string
  price: ReactNode
  metadata: ReactNode
  photos: ReactNode
  sync: ReactNode
  history: ReactNode
  terms: ReactNode
  printing: ReactNode
  saleHref: string
  markSoldHref?: string
}) {
  const editor = useItemQuickEdit({ item, tenantId, write, d })
  const menu = useRef<HTMLDetailsElement>(null)
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null)
  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        menu.current &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
    }
  }, [])
  const t = d.itemDetail
  return (
    <div className="item-workspace">
      <header className="item-workspace-heading">
        <div className="item-workspace-title">
          <h1 aria-label={editor.current.title || d.items.item}>
            {editor.cell('title', d.items.item)}
          </h1>
          <div className="item-workspace-meta">
            <span className="item-detail-reference item-meta-reference">
              <Barcode size={17} aria-hidden="true" />
              {reference}
            </span>
            <span
              className="item-meta-badge item-meta-stage"
              data-stage={item.stage}
            >
              <span className="item-meta-dot" aria-hidden="true" />
              {d.lifecycle.stages[item.stage]}
            </span>
            <span className="item-meta-badge item-meta-ownership">
              {item.ownership === 'consignment' ? (
                <Handshake size={15} aria-hidden="true" />
              ) : (
                <Store size={15} aria-hidden="true" />
              )}
              {d.items.ownershipKinds[item.ownership]}
            </span>
          </div>
        </div>
        {write && (
          <details
            className="item-print-options"
            ref={menu}
            onKeyDown={(event) => {
              if (
                event.key === 'Escape' &&
                !(
                  event.target instanceof Element &&
                  event.target.closest('dialog[open]')
                )
              ) {
                menu.current!.open = false
                menu.current?.querySelector('summary')?.focus()
              }
            }}
          >
            <summary>
              <Printer size={17} aria-hidden="true" />
              {t.print}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="item-print-options-list">{printing}</div>
          </details>
        )}
      </header>
      <div className="item-quick-feedback" role="status" aria-live="polite">
        {editor.message}
        {editor.state === 'uncertain' && (
          <button type="button" className="text-link" onClick={editor.retry}>
            {d.itemWorkflow.retry}
          </button>
        )}
        {editor.state === 'refused' && (
          <button
            type="button"
            className="text-link"
            onClick={() => window.location.reload()}
          >
            {d.itemWorkflow.reload}
          </button>
        )}
      </div>
      <WorkspaceTabs
        id="item"
        label={d.items.item}
        tabs={[
          {
            id: 'overview',
            label: t.overview,
            content: (
              <div className="card item-overview-grid">
                <Link
                  href="#item-photos"
                  className="item-overview-image"
                  aria-label={d.itemPhotos.title}
                >
                  {item.defaultPhotoId &&
                  failedPhoto !== item.defaultPhotoId ? (
                    <Image
                      src={itemPhotoUrl(tenantId, item.id, item.defaultPhotoId)}
                      alt={editor.current.title}
                      width={320}
                      height={320}
                      unoptimized
                      onError={() => setFailedPhoto(item.defaultPhotoId)}
                    />
                  ) : (
                    <span>
                      <ImagePlus size={30} aria-hidden="true" />
                      {write ? d.itemPhotos.add : d.itemPhotos.empty}
                    </span>
                  )}
                </Link>
                <div className="item-overview-fields">
                  <div className="item-overview-price">
                    {price}
                    {write && markSoldHref && (
                      <Link className="btn btn-primary" href={markSoldHref}>
                        {d.sales.markSold}
                      </Link>
                    )}
                    {write && (
                      <Link className="text-link" href={saleHref}>
                        {d.items.manageSalePeriod}
                      </Link>
                    )}
                  </div>
                  <dl className="item-quick-facts">
                    <div>
                      <dt>{d.quickIntake.category}</dt>
                      <dd>
                        {editor.cell(
                          'category',
                          d.quickIntake.category,
                          categories,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{d.quickIntake.itemType}</dt>
                      <dd>
                        {editor.cell('itemType', d.quickIntake.itemType, types)}
                      </dd>
                    </div>
                    <div>
                      <dt>{d.itemWorkflow.group}</dt>
                      <dd>
                        {editor.cell(
                          'assortment',
                          d.itemWorkflow.group,
                          groups,
                        )}
                      </dd>
                    </div>
                    {item.sellerId && (
                      <div>
                        <dt>{d.sellersList.title}</dt>
                        <dd>
                          <Link
                            className="text-link"
                            href={`/intake/sellers/${item.sellerId}`}
                          >
                            {item.sellerName || d.sellersList.title}
                          </Link>
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{d.items.directory.periodEnd}</dt>
                      <dd>
                        <EventTime value={item.periodEnd} locale={locale} />
                      </dd>
                    </div>
                  </dl>
                  {write && (
                    <small className="item-quick-hint">{t.editHint}</small>
                  )}
                  {metadata}
                </div>
              </div>
            ),
          },
          {
            id: 'photos',
            label: `${d.itemPhotos.title} (${item.photoCount})`,
            content: photos,
          },
          {
            id: 'sync',
            label: t.sync,
            anchors: ['sync-status'],
            content: sync,
          },
          { id: 'history', label: t.history, content: history },
          { id: 'terms', label: t.terms, content: terms },
        ]}
      />
    </div>
  )
}
