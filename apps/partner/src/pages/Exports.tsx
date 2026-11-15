import type { ActivityRecorder } from '@cadence/sdk'
import { Plus } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'

import { ExportBuilder } from '@/components/ExportBuilder'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type Me } from '@/lib/api'
import { RELEASED_BY, plural, type Customer, type ExportFile, type ExportRecord } from '@/lib/exports'

const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

interface ExportsProps {
  me: Me
  recorder: RefObject<ActivityRecorder | null>
  /** Open straight into a new export (from the Customers page). */
  startNew: boolean
  /** An export that was just released after verifying with Cadence. */
  justReleased: ExportFile | null
}

/** The export log, and the only place a customer file can be asked for. */
export function Exports({ me, recorder, startNew, justReleased }: ExportsProps) {
  const [building, setBuilding] = useState(startNew)
  const [log, setLog] = useState<ExportRecord[] | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [released, setReleased] = useState<ExportFile | null>(justReleased)

  const load = () =>
    api<{ exports: ExportRecord[] }>('GET', '/exports').then((r) => setLog(r.exports))
  useEffect(() => {
    void load()
    void api<{ customers: Customer[] }>('GET', '/customers').then((r) => setCustomers(r.customers))
  }, [])

  if (building)
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl">New export</h1>
        <ExportBuilder
          customers={customers}
          cadenceOn={me.cadence.connected}
          recorder={recorder}
          onCancel={() => setBuilding(false)}
          onDone={(file) => {
            setReleased(file)
            setBuilding(false)
            void load()
          }}
        />
      </div>
    )

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl">Exports</h1>
          {log && log.length > 0 && <span className="text-muted-foreground tabular-nums">{log.length}</span>}
        </div>
        <Button size="lg" onClick={() => (setReleased(null), setBuilding(true))}>
          <Plus aria-hidden="true" />
          New export
        </Button>
      </div>

      {released && (
        <p role="status" className="rounded-xl border border-good/25 bg-good/8 px-5 py-3.5">
          <span className="font-medium">{released.name}</span> was downloaded: {plural(released.records, 'record')},{' '}
          {plural(released.fields.length, 'field')}.
        </p>
      )}

      {log === null ? (
        <div aria-busy="true" className="grid gap-3 rounded-xl border border-border bg-card p-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      ) : log.length === 0 ? (
        <div className="grid justify-items-start gap-2 rounded-xl border border-border bg-card px-6 py-8">
          <h2 className="text-base">No exports yet</h2>
          <p className="max-w-[60ch] text-muted-foreground">
            Customer records leave Northwind as an export: you choose the customers and the fields, and say what the file is
            for. Each one is listed here, whether or not it was released.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Export</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Fields</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="pr-5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.map((e) => (
                <TableRow key={e.id} className="hover:bg-transparent">
                  <TableCell className="max-w-xs py-3 pl-5 whitespace-normal">
                    <p className="font-medium">{e.name}</p>
                    <p className="line-clamp-2 text-muted-foreground" title={e.reason}>
                      {e.reason}
                    </p>
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{e.records}</TableCell>
                  <TableCell className="text-right align-top tabular-nums">{e.fields.length}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{when(e.created_at)}</TableCell>
                  <TableCell className="pr-5 align-top whitespace-normal">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                        e.released_by ? 'bg-good/12 text-good' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {e.released_by ? 'Released' : 'Not released'}
                    </span>
                    <p className="mt-1 text-muted-foreground">
                      {e.released_by ? RELEASED_BY[e.released_by] : 'Verification was not finished'}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
