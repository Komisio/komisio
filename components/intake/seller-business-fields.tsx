'use client'

import { useId, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import type { BusinessDetails } from '@/lib/engine/seller-business'

export function SellerBusinessFields({
  d,
  initialType = 'private',
  business,
  fixed = false,
}: {
  d: Dictionary['sellerDetails']['business']
  initialType?: 'private' | 'business'
  business?: BusinessDetails
  fixed?: boolean
}) {
  const id = useId()
  const [type, setType] = useState(initialType)
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-type`}>{d.type}</label>
        {fixed ? (
          <>
            <input type="hidden" name="sellerType" value={type} />
            <p id={`${id}-type`}>{d[type]}</p>
          </>
        ) : (
          <select
            id={`${id}-type`}
            name="sellerType"
            value={type}
            onChange={(e) => setType(e.target.value as 'private' | 'business')}
            aria-describedby={`${id}-hint`}
          >
            <option value="private">{d.private}</option>
            <option value="business">{d.business}</option>
          </select>
        )}
        <small id={`${id}-hint`}>{d.typeFixed}</small>
      </div>
      {type === 'business' && (
        <fieldset className="intake-fields">
          <legend>{d.business}</legend>
          {(
            [
              'companyName',
              'organisationNumber',
              'vatNumber',
              'contactPerson',
              'billingAddress',
              'invoiceEmail',
              'invoiceReference',
            ] as const
          ).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={`${id}-${key}`}>{d[key]}</label>
              <input
                id={`${id}-${key}`}
                name={key}
                defaultValue={business?.[key] ?? ''}
                type={key === 'invoiceEmail' ? 'email' : 'text'}
                maxLength={
                  key === 'billingAddress'
                    ? 500
                    : key === 'invoiceEmail'
                      ? 254
                      : key === 'companyName'
                        ? 160
                        : key === 'organisationNumber' || key === 'vatNumber'
                          ? 80
                          : 120
                }
              />
            </div>
          ))}
          <label className="intake-confirm">
            <input
              name="vatRegistered"
              type="checkbox"
              defaultChecked={business?.vatRegistered ?? false}
            />
            {d.vatRegistered}
          </label>
        </fieldset>
      )}
    </>
  )
}
