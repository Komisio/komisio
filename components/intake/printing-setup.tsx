'use client'
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { CircleHelp } from 'lucide-react'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'
import type { PrintDevice } from '@/lib/engine/print-devices'

type Track = 'windows' | 'weblink'
type Progress = {
  track?: Track
  printers?: Partial<Record<Track, string>>
  checks?: Record<string, boolean>
}
const memory = new Map<string, string>()
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener)
  window.addEventListener('komisio-print-setup', listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener('komisio-print-setup', listener)
  }
}
const serverSnapshot = () => ''
const readyClient = () => true
const readyServer = () => false
const subscribeReady = () => () => {}
const Context = createContext<{
  progress: Progress
  save: (next: Progress) => void
  manages: boolean
  weblink: boolean
} | null>(null)

/** Browser-local observations only. No codes, credentials or device authority are stored. */
export function PrintingSetupProvider({
  tenantId,
  actorId,
  manages,
  weblink,
  d,
  children,
}: {
  tenantId: string
  actorId: string
  manages: boolean
  weblink: boolean
  d: Dictionary['printing']
  children: ReactNode
}) {
  const key = `komisio-print-setup-v1:${actorId}:${tenantId}`
  const ready = useSyncExternalStore(subscribeReady, readyClient, readyServer)
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? memory.get(key) ?? ''
      } catch {
        return memory.get(key) ?? ''
      }
    },
    serverSnapshot,
  )
  const progress = useMemo<Progress>(() => {
    try {
      const p = JSON.parse(raw)
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
    } catch {
      return {}
    }
  }, [raw])
  const save = (next: Progress) => {
    const value = JSON.stringify(next)
    memory.set(key, value)
    try {
      localStorage.setItem(key, value)
    } catch {
      /* Checklist remains usable without persistent storage. */
    }
    window.dispatchEvent(new Event('komisio-print-setup'))
  }
  const track =
    progress.track === 'windows' || (weblink && progress.track === 'weblink')
      ? progress.track
      : undefined
  return (
    <Context.Provider
      value={{ progress: { ...progress, track }, save, manages, weblink }}
    >
      {manages && (
        <fieldset className="printer-track-choice">
          <legend>{d.setup.choose}</legend>
          {(['windows', 'weblink'] as const)
            .filter((t) => t === 'windows' || weblink)
            .map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="printer-setup-track"
                  disabled={!ready}
                  checked={track === t}
                  onChange={() => save({ ...progress, track: t })}
                />
                <span>
                  <strong>{d.setup[t]}</strong>
                  <small>{d.setup[`${t}Needs`]}</small>
                </span>
              </label>
            ))}
          {track && (
            <p>
              <a href="#printing-install">{d.setup.openChecklist}</a>
            </p>
          )}
        </fieldset>
      )}
      {children}
    </Context.Provider>
  )
}

/** Keeps forms mounted while changing track, preserving their drafts and unknown outcomes. */
export function PrintingTrack({
  track,
  children,
}: {
  track: Track
  children: ReactNode
}) {
  const ctx = useContext(Context)
  return (
    <div hidden={ctx?.manages && ctx.progress.track !== track}>{children}</div>
  )
}

type Printer = {
  id: string
  name: string
  transport: 'tcp' | 'usb' | 'weblink'
  active: boolean
}
export function PrinterChecklist({
  printers,
  devices,
  download,
  d,
}: {
  printers: Printer[]
  devices: PrintDevice[]
  download: string
  d: Dictionary['printing']
}) {
  const ctx = useContext(Context)!,
    router = useRouter(),
    s = d.setup,
    track = ctx.progress.track
  if (!ctx.manages) return <p>{s.statusOnly}</p>
  if (!track) return <p>{s.choose}</p>
  const matches = printers.filter((p) =>
    track === 'weblink' ? p.transport === 'weblink' : p.transport !== 'weblink',
  )
  const selected = ctx.progress.printers?.[track] ?? matches[0]?.id ?? ''
  const printer = matches.find((p) => p.id === selected)
  const paired = devices.filter(
    (p) => p.printerId === printer?.id && !p.revokedAt,
  )
  const seen = paired.some((p) => p.lastSeenAt && p.printerReachable === true)
  const scope = `${track}:${printer?.id ?? 'new'}`
  const deviceScope =
    paired
      .map((p) => p.id)
      .sort()
      .join(',') || 'none'
  const steps =
    track === 'windows'
      ? [
          {
            id: 'download',
            global: true,
            title: s.winDownload,
            help: d.installDownloadHint,
            link: download,
            linkLabel: d.download,
          },
          {
            id: 'register',
            auto: !!printer,
            title: s.register,
            help: s.registerHelp,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          {
            id: 'code',
            title: s.winCode,
            help: d.installPairHint,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          { id: 'install', title: s.winInstall, help: d.installRunHint },
          { id: 'seen', auto: seen, title: s.seen, help: s.seenHelp },
          {
            id: 'enabled',
            auto: !!printer?.active,
            title: s.enabled,
            help: s.winEnableHelp,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          {
            id: 'test',
            title: s.test,
            help: s.testHelp,
            link: '#printing-labels',
            linkLabel: d.tabs.labels,
          },
        ]
      : [
          {
            id: 'support',
            global: true,
            title: s.webSupport,
            help: s.webSupportHelp,
          },
          {
            id: 'register',
            auto: !!printer,
            title: s.register,
            help: s.registerHelp,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          {
            id: 'prepare',
            auto: paired.length > 0,
            title: s.webPrepare,
            help: s.webPrepareHelp,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          {
            id: 'download',
            title: s.webDownload,
            help: s.webDownloadHelp,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          {
            id: 'file',
            title: s.webFile,
            help: s.webFileHelp,
            illustration: true,
          },
          {
            id: 'enabled',
            auto: !!printer?.active,
            title: s.enabled,
            help: d.weblink.pilotHint,
            link: '#printing-printers',
            linkLabel: d.tabs.printers,
          },
          { id: 'seen', auto: seen, title: s.seen, help: s.seenHelp },
          {
            id: 'test',
            title: s.test,
            help: s.testHelp,
            link: '#printing-labels',
            linkLabel: d.tabs.labels,
          },
        ]
  return (
    <div className="printing-install">
      <h3>{s[track]}</h3>
      <p>{s[`${track}Needs`]}</p>
      {track === 'windows' && <p>{d.installIntro}</p>}
      <p>{s[`${track}Alternative`]}</p>
      <div className="field">
        <label htmlFor="checklist-printer">{s.forPrinter}</label>
        <select
          id="checklist-printer"
          value={printer?.id ?? ''}
          onChange={(e) =>
            ctx.save({
              ...ctx.progress,
              printers: { ...ctx.progress.printers, [track]: e.target.value },
            })
          }
        >
          <option value="">{d.registerHeading}</option>
          {matches.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="printing-hint">{s.progressHint}</p>
      <ol className="printer-checklist">
        {steps.map((step) => {
          const id =
            ('global' in step && step.global ? track : scope) +
            ':' +
            (['file', 'test', 'download'].includes(step.id) &&
            track === 'weblink'
              ? deviceScope + ':'
              : '') +
            step.id
          const automatic = 'auto' in step
          const checked = automatic
            ? !!step.auto
            : ctx.progress.checks?.[id] === true
          return (
            <li key={step.id} data-step={step.id}>
              <div className="printer-step-heading">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={automatic}
                    onChange={(e) =>
                      ctx.save({
                        ...ctx.progress,
                        checks: {
                          ...ctx.progress.checks,
                          [id]: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>
                    {step.title}
                    {automatic && <small>{s.automatic}</small>}
                  </span>
                </label>
                <details>
                  <summary aria-label={`${s.help}: ${step.title}`}>
                    <CircleHelp size={20} aria-hidden="true" />
                  </summary>
                  <div className="printer-step-help">
                    <p>{step.help}</p>
                    {'illustration' in step && step.illustration && (
                      <figure>
                        <SetupIllustration
                          label={s.illustration}
                          select={s.illustrationSelect}
                          restart={s.illustrationRestart}
                        />
                        <figcaption>{s.illustration}</figcaption>
                        <p>{s.illustrationHint}</p>
                      </figure>
                    )}
                  </div>
                </details>
              </div>
              {'link' in step && step.link && (
                <a className="text-link" href={step.link}>
                  {step.linkLabel}
                </a>
              )}
              {step.id === 'seen' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => router.refresh()}
                >
                  {d.weblink.refreshDevices}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <Link className="text-link" href="/intake/items">
        {s.openItems}
      </Link>
    </div>
  )
}

/** Original schematic, deliberately not a screenshot of Zebra's application. */
function SetupIllustration({
  label,
  select,
  restart,
}: {
  label: string
  select: string
  restart: string
}) {
  return (
    <div role="img" aria-label={label} className="zebra-setup-illustration">
      {[
        ['1', 'Zebra ZD420', select],
        ['2', 'Available Files', 'komisio-zebra-setup.zpl'],
        ['3', 'Send To Printer', restart],
      ].map((labels, i) => (
        <svg key={i} viewBox="-2 -2 184 259" aria-hidden="true">
          <rect
            width="180"
            height="255"
            rx="14"
            fill="#fff"
            stroke="#547367"
            strokeWidth="2"
          />
          <circle cx="90" cy="12" r="3" fill="#547367" />
          <rect x="10" y="28" width="160" height="195" rx="4" fill="#f6f8f5" />
          <circle cx="90" cy="65" r="20" fill="#224e40" />
          <text x="90" y="72" textAnchor="middle" fill="#fff" fontSize="22">
            {labels[0]}
          </text>
          <rect
            x="17"
            y="105"
            width="146"
            height="40"
            rx="6"
            fill="#e2ecdf"
            stroke="#547367"
          />
          <text x="90" y="129" textAnchor="middle" fontSize="15" fill="#224e40">
            {labels[1]}
          </text>
          <text
            x="90"
            y="178"
            textAnchor="middle"
            fontSize={i === 1 ? '10' : '13'}
            fill="#224e40"
          >
            {labels[2]}
          </text>
          <circle cx="90" cy="240" r="6" fill="none" stroke="#547367" />
        </svg>
      ))}
    </div>
  )
}
