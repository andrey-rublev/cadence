import type { ActivityRecorder } from '@cadence/sdk'
import { Check, Download, Loader2, Search } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode, type RefObject } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, evidenceToken, explain, type Gate } from '@/lib/api'
import {
  AUDIENCES,
  FIELD_GROUPS,
  PERSONAL_FIELDS,
  downloadExport,
  plural,
  type Audience,
  type Customer,
  type ExportFile,
  type FieldId,
} from '@/lib/exports'

const STEPS = ['Customers', 'Fields', 'Reason'] as const
const CHECKBOX = 'size-4 shrink-0 cursor-pointer accent-primary'

interface ExportBuilderProps {
  customers: Customer[]
  cadenceOn: boolean
  /** The page's recent typing and clicking, handed to Cadence when the export is asked for. */
  recorder: RefObject<ActivityRecorder | null>
  onDone: (file: ExportFile) => void
  onCancel: () => void
}

/**
 * An export is asked for in three steps: which customers, which fields, and why. Nothing is
 * selected for you beyond the two identifying columns, so a file holds only what was chosen.
 */
export function ExportBuilder({ customers, cadenceOn, recorder, onDone, onCancel }: ExportBuilderProps) {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fields, setFields] = useState<Set<FieldId>>(new Set(['id', 'company']))
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [audience, setAudience] = useState<Audience | null>(null)
  const [recipient, setRecipient] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const personal = PERSONAL_FIELDS.filter((f) => fields.has(f.id))
  // The first thing still missing on this step, or null when it is complete.
  const missing = [
    selected.size === 0 ? 'Select at least one customer.' : null,
    fields.size === 0 ? 'Choose at least one field.' : null,
    name.trim().length < 3
      ? 'Name the export.'
      : !reason.trim()
        ? 'Enter a reason for the export.'
        : audience === null
          ? 'Say who will see the file.'
          : audience === 'external' && !recipient.trim()
            ? 'Name the recipient.'
            : !acknowledged
              ? 'Tick the handling statement.'
              : null,
  ][step]

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const evidence = cadenceOn ? await evidenceToken(recorder.current) : null
      const out = await api<Gate<{ export: ExportFile }>>('POST', '/export', {
        evidence,
        name,
        reason,
        audience,
        recipient: audience === 'external' ? recipient : null,
        customer_ids: [...selected],
        fields: [...fields],
        acknowledged,
      })
      if (out.status === 'verify') {
        window.location.assign(out.verify_url)
        return
      }
      downloadExport(out.export)
      onDone(out.export)
    } catch (e) {
      setError(explain(e))
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-3xl gap-5">
      <ol className="flex flex-wrap gap-x-7 gap-y-2 text-sm">
        {STEPS.map((label, i) => {
          const mark = (
            <span
              className={`grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums ${
                i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-good/12 text-good' : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < step ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
            </span>
          )
          return (
            <li key={label} aria-current={i === step ? 'step' : undefined}>
              {i < step ? (
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className="flex cursor-pointer items-center gap-2 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {mark}
                  {label}
                </button>
              ) : (
                <span className={`flex items-center gap-2 ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>
                  {mark}
                  {label}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <section className="grid gap-6 rounded-xl border border-border bg-card p-6">
        {step === 0 && <PickCustomers customers={customers} selected={selected} onSelected={setSelected} />}
        {step === 1 && (
          <PickFields fields={fields} onFields={setFields} sample={customers.find((c) => selected.has(c.id)) ?? null} />
        )}
        {step === 2 && (
          <>
            <StepHeading title="What is this export for?">
              Saved in the export log under your name, where your admins can read it.
            </StepHeading>
            <div className="grid gap-5">
              <Field label="Export name" htmlFor="export-name">
                <Input
                  id="export-name"
                  value={name}
                  maxLength={80}
                  placeholder="Spring renewals call list"
                  onChange={(e) => setName(e.target.value)}
                  className="max-w-sm"
                />
              </Field>
              <Field
                label="Reason"
                htmlFor="export-reason"
                hint="What the file is for and what happens to it afterwards."
              >
                <Textarea
                  id="export-reason"
                  rows={4}
                  value={reason}
                  maxLength={600}
                  aria-describedby="export-reason-hint"
                  className="min-h-24"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <fieldset className="grid gap-2.5">
                <legend className="mb-2.5 text-sm leading-none font-medium">Who will see the file?</legend>
                {AUDIENCES.map(({ id, label }) => (
                  <label key={id} className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="radio"
                      name="audience"
                      checked={audience === id}
                      onChange={() => setAudience(id)}
                      className={CHECKBOX}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              {audience === 'external' && (
                <Field label="Recipient" htmlFor="export-recipient">
                  <Input
                    id="export-recipient"
                    value={recipient}
                    maxLength={120}
                    placeholder="Name and organisation"
                    onChange={(e) => setRecipient(e.target.value)}
                    className="max-w-sm"
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-3 rounded-lg bg-muted px-4 py-3.5 text-sm">
              <p>
                <span className="font-medium">
                  {plural(selected.size, 'customer')}, {plural(fields.size, 'field')}.
                </span>{' '}
                {personal.length > 0
                  ? `Includes personal data: ${personal.map((f) => f.label.toLowerCase()).join(', ')}.`
                  : 'No contact details.'}
              </p>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className={`${CHECKBOX} mt-0.5`}
                />
                I’ll keep this file somewhere access-controlled and delete it when the work is done.
              </label>
            </div>
          </>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-5">
          <Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)} disabled={busy}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
            {missing}
          </p>
          {step < 2 ? (
            <Button size="lg" onClick={() => setStep(step + 1)} disabled={missing !== null}>
              Continue
            </Button>
          ) : (
            <Button size="lg" onClick={submit} disabled={missing !== null || busy}>
              {busy ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              Export {plural(selected.size, 'record')}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h2 className="text-lg">{title}</h2>
      <p className="max-w-[65ch] text-muted-foreground">{children}</p>
    </div>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

function PickCustomers({
  customers,
  selected,
  onSelected,
}: {
  customers: Customer[]
  selected: Set<string>
  onSelected: (next: Set<string>) => void
}) {
  const [plan, setPlan] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const plans = useMemo(() => [...new Set(customers.map((c) => c.plan))].sort(), [customers])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter(
      (c) => (plan === null || c.plan === plan) && (!q || `${c.company} ${c.contact}`.toLowerCase().includes(q)),
    )
  }, [customers, plan, query])
  const shownSelected = shown.filter((c) => selected.has(c.id)).length
  const allShown = shown.length > 0 && shownSelected === shown.length

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    onSelected(next)
  }
  const toggleShown = () => {
    const next = new Set(selected)
    for (const c of shown) if (allShown) next.delete(c.id)
    else next.add(c.id)
    onSelected(next)
  }

  return (
    <>
      <StepHeading title="Which customers?">An export starts empty. Pick the records this one needs.</StepHeading>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Plan" className="flex flex-wrap gap-1.5">
            {[null, ...plans].map((p) => (
              <button
                key={p ?? 'all'}
                type="button"
                aria-pressed={plan === p}
                onClick={() => setPlan(p)}
                className={`h-8 cursor-pointer rounded-lg border px-3 text-sm outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  plan === p
                    ? 'border-primary/40 bg-primary/8 font-medium text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p ?? 'All plans'}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table className="min-w-[480px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShown}
                    disabled={shown.length === 0}
                    ref={(el) => {
                      if (el) el.indeterminate = shownSelected > 0 && !allShown
                    }}
                    onChange={toggleShown}
                    className={`${CHECKBOX} block`}
                  />
                </TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="pr-4 text-right">Seats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow
                  key={c.id}
                  data-state={selected.has(c.id) ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => toggle(c.id)}
                >
                  <TableCell className="py-2.5 pl-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.company}`}
                      checked={selected.has(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(c.id)}
                      className={`${CHECKBOX} block`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{c.company}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contact}</TableCell>
                  <TableCell className="text-muted-foreground">{c.plan}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{c.seats}</TableCell>
                </TableRow>
              ))}
              {shown.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No customers match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {selected.size} of {customers.length} selected
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onSelected(new Set())}
              className="cursor-pointer rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear
            </button>
          )}
        </p>
      </div>
    </>
  )
}

function PickFields({
  fields,
  onFields,
  sample,
}: {
  fields: Set<FieldId>
  onFields: (next: Set<FieldId>) => void
  /** One of the selected customers, to show what each column would hold. */
  sample: Customer | null
}) {
  const base = useId()
  const toggle = (id: FieldId) => {
    const next = new Set(fields)
    if (!next.delete(id)) next.add(id)
    onFields(next)
  }
  return (
    <>
      <StepHeading title="Which fields?">
        Every column you add is one more thing the file can leak. Customer ID and company are on to start; add the rest only if
        the work needs them.
      </StepHeading>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.id} className="grid content-start gap-0.5">
            <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
              {group.label}
              {group.personal && (
                <span className="rounded-md bg-unsure/12 px-1.5 py-0.5 text-xs font-medium text-unsure">Personal data</span>
              )}
            </legend>
            {group.fields.map(({ id, label }) => (
              <label
                key={id}
                htmlFor={`${base}-${id}`}
                className="-mx-2.5 flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150 hover:bg-muted"
              >
                <input
                  id={`${base}-${id}`}
                  type="checkbox"
                  checked={fields.has(id)}
                  onChange={() => toggle(id)}
                  className={`${CHECKBOX} mt-0.5`}
                />
                <span className="grid min-w-0 text-sm">
                  {label}
                  {sample && <span className="truncate text-muted-foreground">{String(sample[id])}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </>
  )
}
