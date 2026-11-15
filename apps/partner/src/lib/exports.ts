/** Customer records and exports of them, as Northwind's API returns them. */

export interface Customer {
  id: string
  company: string
  contact: string
  email: string
  phone: string
  plan: string
  seats: number
  since: string
}

export type FieldId = keyof Customer

/** What an export may contain, in file order. Contact details are personal data. */
export const FIELD_GROUPS: {
  id: string
  label: string
  personal: boolean
  fields: { id: FieldId; label: string }[]
}[] = [
  {
    id: 'account',
    label: 'Account',
    personal: false,
    fields: [
      { id: 'id', label: 'Customer ID' },
      { id: 'company', label: 'Company' },
      { id: 'plan', label: 'Plan' },
      { id: 'seats', label: 'Seats' },
      { id: 'since', label: 'Customer since' },
    ],
  },
  {
    id: 'contact',
    label: 'Contact details',
    personal: true,
    fields: [
      { id: 'contact', label: 'Contact name' },
      { id: 'email', label: 'Email' },
      { id: 'phone', label: 'Phone' },
    ],
  },
]

export const PERSONAL_FIELDS = FIELD_GROUPS.filter((g) => g.personal).flatMap((g) => g.fields)

export type Audience = 'me' | 'team' | 'external'

export const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'me', label: 'Only me' },
  { id: 'team', label: 'My team at Northwind' },
  { id: 'external', label: 'Someone outside Northwind' },
]

/** How an export was let through. Null while it has not been. */
export type ReleasedBy = 'behavior' | 'test' | 'fallback' | 'recent' | 'password'

/** A line of the export log. */
export interface ExportRecord {
  id: string
  name: string
  reason: string
  audience: Audience
  recipient: string | null
  records: number
  fields: FieldId[]
  created_at: number
  released_at: number | null
  released_by: ReleasedBy | null
}

/** A released export: the log line plus exactly the rows and fields that were asked for. */
export interface ExportFile extends ExportRecord {
  rows: Partial<Customer>[]
}

export const RELEASED_BY: Record<ReleasedBy, string> = {
  behavior: 'Cadence recognised your typing and clicking',
  test: 'Verified with a Cadence test',
  fallback: 'Verified with a Cadence code',
  recent: 'Verified a few minutes earlier',
  password: 'Password only',
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function downloadExport(file: ExportFile) {
  const cell = (value: string | number | undefined) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [file.fields.join(','), ...file.rows.map((row) => file.fields.map((f) => cell(row[f])).join(','))].join('\r\n')
  const slug = file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  Object.assign(document.createElement('a'), { href: url, download: `northwind-${slug}-fictional.csv` }).click()
  URL.revokeObjectURL(url)
}
