import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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

  useEffect(() => {
    api.request<{ customers: Customer[] }>('GET', '/customers').then((r) => setCustomers(r.customers))
  }, [])

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

      <div className="overflow-x-auto rounded-xl border border-rule bg-card">
        <Table className="min-w-[720px] text-base">
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Seats</TableHead>
              <TableHead>Customer since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.company}</TableCell>
                <TableCell>{c.contact}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{c.email}</TableCell>
                <TableCell>{c.plan}</TableCell>
                <TableCell className="text-right tabular-nums">{c.seats}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{c.since}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        Viewing this list needs only your sign-in. Exporting it is protected: the server releases the file only
        after a movement check or trusted verification, whatever this page does.
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
