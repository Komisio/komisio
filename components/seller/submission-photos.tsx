import Image from 'next/image'
import { X } from 'lucide-react'

export function SubmissionPhotos({
  photos,
  label,
  removeLabel,
  onRemove,
  disabled = false,
}: {
  photos: string[]
  label: string
  removeLabel?: string
  onRemove?: (path: string) => void
  disabled?: boolean
}) {
  return (
    <div className="submission-photos">
      {photos.map((path) => {
        const [tenant, seller, filename] = path.split('/')
        const query = new URLSearchParams({
          tenant,
          seller,
          photo: filename.replace(/\.jpg$/, ''),
        })
        const src = `/api/seller/submissions/photo?${query}`
        return (
          <div key={path} className="submission-photo">
            <a href={src} target="_blank" rel="noreferrer">
              <Image
                src={src}
                alt={label}
                width={112}
                height={112}
                unoptimized
              />
            </a>
            {onRemove && (
              <button
                type="button"
                className="submission-photo-remove"
                disabled={disabled}
                aria-label={`${removeLabel} ${photos.indexOf(path) + 1}`}
                onClick={() => onRemove(path)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
