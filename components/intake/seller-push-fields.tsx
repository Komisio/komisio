'use client'
import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { StorePolicyBody } from '@/lib/engine/store-policy'
import { Button } from '@/components/ui/button'

export function SellerPushFields({
  policy,
  copy,
}: {
  policy: StorePolicyBody
  copy: Dictionary['sellerPush']
}) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(
    () => () => {
      audio.current?.pause()
    },
    [],
  )
  async function preview(sound: string) {
    audio.current?.pause()
    if (playing === sound) {
      audio.current = null
      setPlaying(null)
      return
    }
    setFailed(false)
    const player = new Audio(`/sounds/${sound}`)
    audio.current = player
    player.onended = () => {
      if (audio.current === player) setPlaying(null)
    }
    player.onerror = () => {
      if (audio.current === player) {
        setPlaying(null)
        setFailed(true)
      }
    }
    setPlaying(sound)
    try {
      await player.play()
    } catch {
      if (audio.current === player) {
        setPlaying(null)
        setFailed(true)
      }
    }
  }
  return (
    <section className="seller-push-settings" aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p>{copy.hint}</p>
      {(
        [
          ['pushItemRegistered', 'registeredstore.wav', copy.registered],
          ['pushItemSold', 'sale.wav', copy.sold],
        ] as const
      ).map(([field, sound, label]) => (
        <div key={field} className="row wrap">
          <label className="intake-confirm">
            <input
              type="checkbox"
              name={field}
              defaultChecked={policy[field] === true}
            />
            {label}
          </label>
          <Button
            type="button"
            variant="secondary"
            aria-label={`${playing === sound ? copy.stop : copy.preview}: ${label}`}
            onClick={() => void preview(sound)}
          >
            {playing === sound ? copy.stop : copy.preview}
          </Button>
        </div>
      ))}
      {failed && (
        <p role="alert" className="error">
          {copy.previewFailed}
        </p>
      )}
    </section>
  )
}
