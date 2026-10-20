# Help content

Signed-in store staff can read help from the header or `/help` when
`KOMISIO_INTAKE_ENABLED=true`. The help search runs in the browser. Articles
describe current behaviour; they must not advertise planned features.

## Files and translations

Each article lives at `content/help/{locale}/{slug}.md`. Supported locales are
`sv`, `en`, `no`, `dk`, `fi`, `de`, `es` and `it`. Slugs use lowercase letters,
digits and single separating hyphens, up to 80 characters. They are permanent
links at `/help/{slug}`.

Every article needs Swedish and English files. Other languages are optional.
A missing translation displays English with a localized notice. This fallback
applies only to help; the product's existing locale fallback is unchanged.
Set `machineTranslated: true` on automatically translated files to show the
separate translation notice. Reviewed legacy translations use `false`.

## Front matter

Start each file with YAML between `---` lines:

```yaml
---
title: Members and roles
summary: Give each colleague the access they need.
routes:
  - path: /members
taskLinks:
  - href: /members
    label: Open members
externalLinks: []
lastReviewed: 2026-10-20
machineTranslated: false
---
```

The schema rejects unknown keys. `title` is 1–80 characters; `summary` is
1–240. `lastReviewed` is a real ISO calendar date. `machineTranslated` defaults
to false and `externalLinks` defaults to an empty array. `video` is reserved:
omit it or set it to null.

`routes` may be empty. Each entry has a dashboard `path` and optional `view`
and `tab`. Dynamic segments use Next.js syntax, such as `/intake/items/[id]`,
and match one nonempty segment. Both selectors take precedence over view,
then tab, then path alone. Exact paths win ties over parameterized paths.
Duplicate `(path, view, tab)` claims fail validation.

`taskLinks` contain an internal `href` and translated `label`. Query strings
and hashes are allowed. Routes must exist under `app/(dashboard)`; links
must resolve to a dashboard page. A link does not grant access to that page.
Across translations, routes, task-link destinations and external allowlists
must match the English file exactly, including order.

## Markdown

Use paragraphs, level-two or level-three headings, ordered or unordered lists,
emphasis, bold, inline code, block quotes and links. Block quotes appear as
notice callouts. Do not use a level-one heading: the page supplies the title.

Raw HTML, images, tables, footnotes, code blocks and unsupported nodes fail
validation with a file and line. Rendering uses React elements, never HTML
injection. Internal links start with a single `/`. External links must use
HTTPS and appear in `externalLinks`; they open in a separate tab with
`rel="noreferrer"`.

## Adding or reviewing an article

1. Verify the instructions against the current page and engine behaviour.
2. Write the Swedish and English files with matching routing and links.
3. Add other translations, or let them fall back to English.
4. Run `npm run help:build`, then review the generated diff.
5. Run the help unit tests and relevant browser journeys. Check the article
   from its mapped page as well as its full page, including keyboard use.
6. Commit the Markdown and `lib/help/content.generated.ts` together.

The generator uses development-only YAML and Markdown parsers. Runtime code
imports generated data without reading files, including on Docker and Vercel.
Unit tests regenerate in memory and fail for stale generated content; the
production build also validates it. Search includes title, summary and body.

## Feedback and privacy

Every article offers Yes/No, an optional comment and a Send button. Successful
submission hides the form for that article and store for the rest of the
browser session. This is a usability guard, not an identity-based voting system.

`help_feedback` stores a tenant ID, article slug, locale, sanitized page,
answer, optional comment and timestamp. It has **no user ID**. Dynamic page
segments become route placeholders, and only known `view`/`tab` values remain.
The database also rejects real record identifiers and arbitrary query values.
Keep its page allowlist aligned with `lib/help/support-routes.ts` and
`supportPage` through an additive migration when adding routes.

Owners, administrators, staff and read-only members may submit through the
authenticated engine function. Devices, automation, nonmembers and other
tenants cannot. Direct table reads and writes are denied to product sessions.
Operators use authorized administrative database access to review feedback;
there is no feedback report in the product.

A database lock enforces at most 200 submissions per tenant in a rolling
24-hour window. Comments are free text and may contain personal data despite
the warning: handle them accordingly. Automatic purging and retention policies
are outside this feature's scope.
