export type HelpNode =
  | { type: 'text' | 'inlineCode'; value: string }
  | {
      type: 'paragraph' | 'emphasis' | 'strong' | 'blockquote' | 'listItem'
      children: HelpNode[]
    }
  | { type: 'heading'; depth: 2 | 3; children: HelpNode[] }
  | { type: 'list'; ordered: boolean; start: number; children: HelpNode[] }
  | { type: 'link'; url: string; children: HelpNode[] }

export type HelpRoute = { path: string; view?: string; tab?: string }
export type HelpContent = {
  title: string
  summary: string
  routes: HelpRoute[]
  taskLinks: { href: string; label: string }[]
  externalLinks: string[]
  lastReviewed: string
  machineTranslated: boolean
  body: HelpNode[]
  text: string
}
