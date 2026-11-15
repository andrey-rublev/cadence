import type { ActivityRecorder } from '@cadence/sdk'
import { Download, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type RefObject } from 'react'

import { Verdict } from '@/components/Brand'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, evidenceToken, explain, type CheckSummary, type Gate, type Me } from '@/lib/api'

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

export function downloadCsv(customers: Customer[]) {
  const columns: (keyof Customer)[] = ['id', 'company', 'contact', 'email', 'phone', 'plan', 'seats', 'since']
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  const csv = [columns.join(','), ...customers.map((c) => columns.map((k) => cell(c[k])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  Object.assign(document.createElement('a'), { href: url, download: 'northwind-customers-fictional.csv' }).click()
  URL.revokeObjectURL(url)
}

export interface Released {
  customers: Customer[]
  check: CheckSummary | null
}

interface CustomersProps {
  me: Me
  /** The page's recent typing and clicking, handed to Cadence when an export needs a check. */
  recorder: RefObject<ActivityRecorder | null>
  released: Released | null
}

export function Customers({ me, recorder, released: initial }: CustomersProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [released, setReleased] = useState<Released | null>(initial)

  useEffect(() => {
    api<{ customers: Customer[] }>('GET', '/customers').then((r) => setCustomers(r.customers))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? customers.filter((c) => `${c.company} ${c.contact} ${c.plan}`.toLowerCase().includes(q)) : customers
  }, [customers, query])
  const current = customers.find((c) => c.id === selected) ?? null

  async function exportAll() {
    setBusy(true)
    setError(null)
    try {
      const evidence = me.cadence.connected ? await evidenceToken(recorder.current) : null
      const out = await api<Gate<{ customers: Customer[] }>>('POST', '/export', { evidence })
      if (out.status === 'verify') {
        window.location.assign(out.verify_url)
        return
      }
      setReleased({ customers: out.customers, check: out.check ?? null })
      downloadCsv(out.customers)
    } catch (e) {
      setError(explain(e))
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Fictional data · invented for this demo</p>
          <h1 className="text-3xl font-semibold">Customers</h1>
        </div>
        <Button size="lg" onClick={exportAll} disabled={busy} className="h-11 px-5 text-base">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          Export customer records
        </Button>
      </div>

      {released && (
        <div className="grid gap-2 rounded-lg border border-good/40 bg-good/5 p-4" role="status">
          <p className="font-medium">Export released: {released.customers.length} fictional records.</p>
          {released.check ? <Verdict check={released.check} what="export" /> : <p className="text-sm">Cadence is not turned on for this account, so the export needed only your password.</p>}
          <Button variant="outline" onClick={() => downloadCsv(released.customers)} className="h-10 justify-self-start px-4">
            <Download aria-hidden="true" />
            Download again
          </Button>
        </div>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search company, contact or plan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 bg-card pl-9 text-base"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table className="min-w-[520px] text-base">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((c) => (
                  <TableRow key={c.id} data-state={c.id === selected ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                    <TableCell className="font-medium">
                      <button type="button" className="cursor-pointer text-left underline-offset-4 hover:underline focus-visible:underline">
                        {c.company}
                      </button>
                    </TableCell>
                    <TableCell>{c.contact}</TableCell>
                    <TableCell>{c.plan}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.seats}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No customers match “{query}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <aside className="grid gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">{current ? current.company : 'Account notes'}</h2>
          {current ? (
            <>
              <p className="text-sm text-muted-foreground">
                {current.contact} · {current.plan} · since {current.since}
              </p>
              <p className="font-mono text-sm break-all text-muted-foreground">{current.email}</p>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={6}
                placeholder="Call summary, next steps…"
                value={notes[current.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [current.id]: e.target.value })}
                className="text-base"
              />
            </>
          ) : (
            <p className="text-muted-foreground">Pick a customer to read or write notes about them.</p>
          )}
        </aside>
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        Exporting is a sensitive action. {me.cadence.connected
          ? 'Northwind asks Cadence whether your recent typing and clicking look like you; if Cadence is unsure, you confirm on Cadence.'
          : 'Turn on Cadence under Security to protect it with a second check.'}
      </p>
    </div>
  )
}
