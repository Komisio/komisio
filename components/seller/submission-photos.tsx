import Image from 'next/image'

export function SubmissionPhotos({
  photos,
  label,
}: {
  photos: string[]
  label: string
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
          <a href={src} key={path} target="_blank" rel="noreferrer">
            <Image src={src} alt={label} width={112} height={112} unoptimized />
          </a>
        )
      })}
    </div>
  )
}
