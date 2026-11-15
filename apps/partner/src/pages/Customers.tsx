import { Download, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import type { Customer } from '@/lib/exports'

/** Browsing and notes. Taking records out of Northwind is a separate thing: an export. */
export function Customers({ onNewExport }: { onNewExport: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    api<{ customers: Customer[] }>('GET', '/customers').then((r) => setCustomers(r.customers))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? customers.filter((c) => `${c.company} ${c.contact} ${c.plan}`.toLowerCase().includes(q)) : customers
  }, [customers, query])
  const current = customers.find((c) => c.id === selected) ?? null

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl">Customers</h1>
          {customers.length > 0 && <span className="text-muted-foreground tabular-nums">{customers.length}</span>}
        </div>
        <Button variant="outline" size="lg" onClick={onNewExport}>
          <Download aria-hidden="true" />
          New export
        </Button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search customers"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="pr-5 text-right">Seats</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((c) => (
                  <TableRow key={c.id} data-state={c.id === selected ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                    <TableCell className="py-3 pl-5 font-medium">
                      <button type="button" className="cursor-pointer rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        {c.company}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.contact}</TableCell>
                    <TableCell className="text-muted-foreground">{c.plan}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{c.seats}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && customers.length > 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No customers match “{query}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <aside className="grid gap-4 rounded-xl border border-border bg-card p-5 lg:mt-[3.25rem]">
          {current ? (
            <>
              <div className="grid gap-1">
                <h2 className="text-base">{current.company}</h2>
                <p className="text-sm text-muted-foreground">{current.contact}</p>
                <p className="text-sm break-all text-muted-foreground">{current.email}</p>
                <p className="text-sm text-muted-foreground">
                  {current.plan} plan since {current.since}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={6}
                  placeholder="Call summary, next steps"
                  value={notes[current.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [current.id]: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-base">Notes</h2>
              <p className="text-sm text-muted-foreground">Select a customer to see their details and add notes.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
