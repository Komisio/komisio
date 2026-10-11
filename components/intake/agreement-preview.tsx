import { intlLocale, type Dictionary, type Locale } from '@/lib/i18n'

export type AgreementPreviewText = {
  title: string
  body: string
  language: Locale
}

export function readAgreementPreview(
  form: HTMLFormElement,
): AgreementPreviewText {
  return {
    title: (form.elements.namedItem('title') as HTMLInputElement).value,
    body: (form.elements.namedItem('body') as HTMLTextAreaElement).value,
    language: (form.elements.namedItem('language') as HTMLSelectElement)
      .value as Locale,
  }
}

export function AgreementPreview({
  text,
  labels,
}: {
  text: AgreementPreviewText
  labels: Dictionary['agreements']['editor']
}) {
  return (
    <section className="agreement-editor-preview" aria-label={labels.preview}>
      <h3>{labels.preview}</h3>
      <article lang={intlLocale(text.language)}>
        {text.title && <h4>{text.title}</h4>}
        <div className="agreement-preview-body">
          {text.body || labels.emptyPreview}
        </div>
      </article>
    </section>
  )
}
