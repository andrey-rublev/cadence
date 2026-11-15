import { Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { Customer, Me } from '@/lib/product'

import { ExportFlow } from './ExportFlow'

interface CustomersViewProps {
  me: Me
  onMe: (me: Me) => void
  onSetUpProfile: () => void
}

export function CustomersView({ me, onMe, onSetUpProfile }: CustomersViewProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [exporting, setExporting] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  // Notes live only in this page. Cadence sees when keys go down and up, never what was typed.
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    api.request<{ customers: Customer[] }>('GET', '/customers').then((r) => setCustomers(r.customers))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? customers.filter((c) => `${c.company} ${c.contact} ${c.plan}`.toLowerCase().includes(q)) : customers
  }, [customers, query])
  const current = customers.find((c) => c.id === selected) ?? null

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-muted-foreground">Fictional data · invented for this demo</p>
          <h1 className="text-4xl font-extrabold">Customers</h1>
        </div>
        <Button size="lg" onClick={() => setExporting(true)} className="h-11 px-5 text-base">
          <ShieldCheck aria-hidden="true" />
          Export customer records
        </Button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-3">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search company, contact or plan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 pl-9 text-base"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-rule bg-card">
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
                  <TableRow
                    key={c.id}
                    data-state={c.id === selected ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => setSelected(c.id)}
                  >
                    <TableCell className="font-medium">
                      <button type="button" className="text-left underline-offset-4 hover:underline focus-visible:underline">
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

        <aside className="grid gap-3 rounded-xl border border-rule bg-card p-5">
          <h2 className="text-lg font-bold">{current ? current.company : 'Account notes'}</h2>
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
              <p className="text-xs text-muted-foreground">
                Notes stay in this page. Cadence only sees typing rhythm, never the text.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Pick a customer to read or write notes about them.</p>
          )}
        </aside>
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        Viewing this list needs only your sign-in. Exporting it is protected: the server releases the file only when
        recent activity matches your profile, or after trusted verification, whatever this page does.
      </p>

      {exporting && (
        <ExportFlow
          me={me}
          onMe={onMe}
          onClose={() => setExporting(false)}
          onSetUpProfile={() => {
            setExporting(false)
            onSetUpProfile()
          }}
        />
      )}
    </div>
  )
}
