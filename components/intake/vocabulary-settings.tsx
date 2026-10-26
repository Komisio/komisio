'use client'
import { DeleteCatalogueRecord } from './delete-catalogue-record'

import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { labelOf, type AttributeVocabulary } from '@/lib/engine/attributes'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { CreateItemType } from './create-item-type'
import { CreateAttribute } from './create-attribute'
import { AssortmentSettings } from './assortment-settings'
import { CategorySettings } from './category-settings'
import { SettingsSectionHelp } from './settings-section-help'
import { EditCatalogue } from './edit-catalogue'
import { Button } from '@/components/ui/button'
import type { ItemTypeProfile } from '@/lib/engine/attributes'
import type { ItemCategory } from '@/lib/engine/item-categories'
import './vocabulary-settings.css'

export function VocabularySettings({
  tenantId,
  initial,
  groups,
  categories: initialCategories,
  locale,
  editable,
  d,
}: {
  tenantId: string
  initial: AttributeVocabulary
  groups: { id: string; name: string }[]
  categories: ItemCategory[]
  locale: string
  editable: boolean
  d: Dictionary
}) {
  const t = d.vocabularySettings
  const [vocabulary, setVocabulary] = useState(initial)
  const [categories, setCategories] = useState(initialCategories)
  const [typeSearch, setTypeSearch] = useState('')
  const [showInactiveTypes, setShowInactiveTypes] = useState(false)
  const [attributeSearch, setAttributeSearch] = useState('')
  const [savedType, setSavedType] = useState('')
  const [savedAttribute, setSavedAttribute] = useState('')
  const [editingType, setEditingType] = useState<ItemTypeProfile | null>(null)
  const definitions = new Map(vocabulary.definitions.map((a) => [a.slug, a]))
  const matches = (label: string, query: string) =>
    label
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale))
  const types = vocabulary.types
    .filter(
      (v) =>
        (v.active || showInactiveTypes) &&
        matches(labelOf(v, locale), typeSearch),
    )
    .sort((a, b) =>
      labelOf(a, locale).localeCompare(labelOf(b, locale), locale),
    )
  const attributes = vocabulary.definitions
    .filter((v) => v.active && matches(labelOf(v, locale), attributeSearch))
    .sort((a, b) =>
      labelOf(a, locale).localeCompare(labelOf(b, locale), locale),
    )
  return (
    <section className="vocabulary-settings" aria-label={t.title}>
      <div className="vocabulary-heading">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
      </div>
      <WorkspaceTabs
        id="vocabulary"
        initial="types"
        label={t.title}
        tabs={[
          {
            id: 'categories',
            label: t.categories,
            content: (
              <CategorySettings
                tenantId={tenantId}
                initial={categories}
                onChanged={setCategories}
                locale={locale}
                editable={editable}
                d={d}
              />
            ),
          },
          {
            id: 'types',
            label: t.types,
            content: (
              <div className="card vocabulary-panel">
                <SettingsSectionHelp
                  label={`${d.settingsHelp.label}: ${t.types}`}
                  steps={d.settingsHelp.types}
                />
                <div className="vocabulary-toolbar">
                  <div className="field">
                    <label htmlFor="type-search">{t.searchTypes}</label>
                    <input
                      id="type-search"
                      type="search"
                      value={typeSearch}
                      onChange={(e) => setTypeSearch(e.target.value)}
                    />
                  </div>
                </div>
                {editable && (
                  <CreateItemType
                    tenantId={tenantId}
                    vocabulary={vocabulary}
                    lang={locale}
                    disabled={false}
                    d={d.quickIntake}
                    settings={t}
                    onSelect={(profile) => {
                      setVocabulary((v) => ({
                        ...v,
                        types: [
                          ...v.types.filter((p) => p.slug !== profile.slug),
                          profile,
                        ],
                      }))
                      setTypeSearch('')
                      setSavedType(
                        t.saved.replace('{name}', labelOf(profile, locale)),
                      )
                    }}
                  />
                )}
                <p role="status">{savedType}</p>
                <div className="vocabulary-field-choices">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showInactiveTypes}
                      onChange={(e) => setShowInactiveTypes(e.target.checked)}
                    />
                    {d.catalogueEditing.showInactive}
                  </label>
                </div>
                {editable && editingType && (
                  <EditCatalogue
                    key={editingType.slug}
                    kind="type"
                    record={editingType}
                    definitions={vocabulary.definitions}
                    categories={categories}
                    tenantId={tenantId}
                    locale={locale}
                    d={d}
                    onClose={() => setEditingType(null)}
                    onSaved={(profile) => {
                      setVocabulary((v) => ({
                        ...v,
                        types: v.types.map((t) =>
                          t.slug === profile.slug ? profile : t,
                        ),
                      }))
                      setSavedType(
                        t.saved.replace('{name}', labelOf(profile, locale)),
                      )
                    }}
                  />
                )}
                <table className="vocabulary-table">
                  <caption className="sr-only">{t.types}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.name}</th>
                      <th scope="col">{t.fields}</th>
                      {editable && (
                        <th scope="col">{d.catalogueDeletion.actions}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((type) => (
                      <tr key={type.slug}>
                        <th scope="row">
                          {labelOf(type, locale)}
                          <small>{type.own ? t.own : t.standard}</small>
                          {!type.active && (
                            <small>{d.catalogueEditing.inactive}</small>
                          )}
                        </th>
                        <td>
                          {type.attributes
                            .flatMap((entry) => {
                              const a = definitions.get(entry.slug)
                              return a?.active ? [labelOf(a, locale)] : []
                            })
                            .join(' · ') || '—'}
                        </td>
                        {editable && (
                          <td className="catalogue-actions">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={!!editingType}
                              onClick={() => setEditingType(type)}
                            >
                              {d.catalogueEditing.edit}
                            </Button>
                            {type.own ? (
                              <DeleteCatalogueRecord
                                tenantId={tenantId}
                                kind="type"
                                recordKey={type.slug}
                                name={labelOf(type, locale)}
                                d={d}
                                onDeleted={() => {
                                  setVocabulary((v) => ({
                                    ...v,
                                    types: v.types.filter(
                                      (row) => row.slug !== type.slug,
                                    ),
                                  }))
                                  setSavedType(
                                    d.catalogueDeletion.deleted.replace(
                                      '{name}',
                                      labelOf(type, locale),
                                    ),
                                  )
                                }}
                              />
                            ) : (
                              <small>{d.catalogueDeletion.shared}</small>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {types.length === 0 && <p>{t.noMatches}</p>}
              </div>
            ),
          },
          {
            id: 'attributes',
            label: t.attributes,
            content: (
              <div className="card vocabulary-panel">
                <SettingsSectionHelp
                  label={`${d.settingsHelp.label}: ${t.attributes}`}
                  steps={d.settingsHelp.attributes}
                />
                <div className="vocabulary-toolbar">
                  <div className="field">
                    <label htmlFor="attribute-search">{t.searchFields}</label>
                    <input
                      id="attribute-search"
                      type="search"
                      value={attributeSearch}
                      onChange={(e) => setAttributeSearch(e.target.value)}
                    />
                  </div>
                </div>
                {editable && (
                  <CreateAttribute
                    tenantId={tenantId}
                    locale={locale}
                    d={d}
                    onCreated={(definition) => {
                      setVocabulary((v) => ({
                        ...v,
                        definitions: [
                          ...v.definitions.filter(
                            (a) => a.slug !== definition.slug,
                          ),
                          definition,
                        ],
                      }))
                      setAttributeSearch('')
                      setSavedAttribute(
                        t.saved.replace('{name}', labelOf(definition, locale)),
                      )
                    }}
                  />
                )}
                <p role="status">{savedAttribute}</p>
                <table className="vocabulary-table">
                  <caption className="sr-only">{t.attributes}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t.name}</th>
                      <th scope="col">{t.kind}</th>
                      {editable && (
                        <th scope="col">{d.catalogueDeletion.actions}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {attributes.map((a) => (
                      <tr key={a.slug}>
                        <th scope="row">
                          {labelOf(a, locale)}
                          <small>{a.own ? t.own : t.standard}</small>
                        </th>
                        <td>
                          {t.kinds[a.data_type]}
                          {a.unit && ` (${a.unit})`}
                          {a.choices.length > 0 && (
                            <small>
                              {a.choices
                                .map((c) =>
                                  labelOf(
                                    { slug: c.id, labels: c.labels },
                                    locale,
                                  ),
                                )
                                .join(' · ')}
                            </small>
                          )}
                        </td>
                        {editable && (
                          <td className="catalogue-actions">
                            {a.own ? (
                              <DeleteCatalogueRecord
                                tenantId={tenantId}
                                kind="attribute"
                                recordKey={a.slug}
                                name={labelOf(a, locale)}
                                d={d}
                                onDeleted={() => {
                                  setVocabulary((v) => ({
                                    ...v,
                                    definitions: v.definitions.filter(
                                      (row) => row.slug !== a.slug,
                                    ),
                                  }))
                                  setSavedAttribute(
                                    d.catalogueDeletion.deleted.replace(
                                      '{name}',
                                      labelOf(a, locale),
                                    ),
                                  )
                                }}
                              />
                            ) : (
                              <small>{d.catalogueDeletion.shared}</small>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {attributes.length === 0 && <p>{t.noMatches}</p>}
              </div>
            ),
          },
          {
            id: 'groups',
            label: t.groups,
            content: (
              <AssortmentSettings
                tenantId={tenantId}
                initial={groups}
                editable={editable}
                d={d}
              />
            ),
          },
        ]}
      />
    </section>
  )
}
