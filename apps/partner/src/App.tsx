import type { ActivityRecorder } from '@cadence/sdk'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Logo } from '@/components/Brand'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain, recordActivity, type Me } from '@/lib/api'
import { downloadExport, type ExportFile } from '@/lib/exports'
import { Account } from '@/pages/Account'
import { Customers } from '@/pages/Customers'
import { Exports } from '@/pages/Exports'
import { Login } from '@/pages/Login'
import { Security } from '@/pages/Security'

type View = 'customers' | 'exports' | 'security' | 'account'

/** Where Cadence sends people back: linking (/cadence/callback) or after verifying (/cadence/return). */
async function handleReturn(): Promise<{ me?: Me; view?: View; error?: string; released?: ExportFile; deleted?: true } | null> {
  const path = window.location.pathname
  const params = new URLSearchParams(window.location.search)
  const clean = () => window.history.replaceState(null, '', '/')
  try {
    if (path === '/cadence/callback') {
      clean()
      if (params.get('error')) return { view: 'security', error: 'Cadence was not connected.' }
      const me = await api<Me>('POST', '/cadence/callback', { code: params.get('code'), state: params.get('state') })
      return { me, view: 'security' }
    }
    if (path === '/cadence/return') {
      clean()
      const out = await api<
        | { kind: 'sign_in'; me: Me }
        | { kind: 'export'; export: ExportFile }
        | { kind: 'delete' }
      >('POST', '/finish', { pending: params.get('pending') })
      if (out.kind === 'sign_in') return { me: out.me }
      if (out.kind === 'delete') return { deleted: true }
      downloadExport(out.export)
      return { view: 'exports', released: out.export }
    }
  } catch (e) {
    return { error: explain(e) }
  }
  return null
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [view, setView] = useState<View>('customers')
  const [notice, setNotice] = useState<string | null>(null)
  const [accountDeleted, setAccountDeleted] = useState(false)
  // Exports: whether to open straight into a new one, and one just released on the way back from Cadence.
  const [newExport, setNewExport] = useState(false)
  const [released, setReleased] = useState<ExportFile | null>(null)
  const recorder = useRef<ActivityRecorder | null>(null)
  const returning = useRef<ReturnType<typeof handleReturn> | null>(null)

  useEffect(() => {
    // Share the return request across effect replays so a pending action only finishes once.
    returning.current ??= handleReturn()
    let active = true
    void (async () => {
      const back = await returning.current
      if (!active) return
      const current = back?.deleted ? null : back?.me ?? (await api<Me | null>('GET', '/me').catch(() => null))
      if (!active) return
      if (back?.view) setView(back.view)
      if (back?.error) setNotice(back.error)
      if (back?.released) setReleased(back.released)
      if (back?.deleted) setAccountDeleted(true)
      setMe(current)
    })()
    return () => {
      active = false
    }
  }, [])

  // While signed in, the page keeps the last few minutes of typing and clicking, ready to hand
  // to Cadence when a sensitive action needs it. Nothing is sent until then.
  useEffect(() => {
    if (!me?.cadence.connected) return
    recorder.current = recordActivity({ keepMs: 5 * 60_000 })
    return () => recorder.current?.stop()
  }, [me?.cadence.connected])

  async function signOut() {
    await api('POST', '/logout').catch(() => undefined)
    setMe(null)
  }

  function onAccountDeleted() {
    setMe(null)
    setView('customers')
    setNotice(null)
    setNewExport(false)
    setReleased(null)
    setAccountDeleted(true)
  }

  if (me === undefined) return <div aria-busy className="min-h-dvh" />
  if (me === null)
    return (
      <Login
        onSignedIn={(m) => (setMe(m), setNotice(null), setAccountDeleted(false))}
        notice={notice}
        status={accountDeleted ? 'Your Northwind account was deleted.' : undefined}
      />
    )

  const nav: { id: View; label: string }[] = [
    { id: 'customers', label: 'Customers' },
    { id: 'exports', label: 'Exports' },
    { id: 'security', label: 'Security' },
    { id: 'account', label: 'Account' },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-chrome text-chrome-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-5 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-8 sm:py-0">
          <Logo inverted />
          <nav aria-label="Northwind" className="order-last flex w-full flex-wrap gap-0.5 sm:order-none sm:w-auto sm:flex-nowrap sm:gap-1">
            {nav.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => (setNewExport(false), setReleased(null), setView(id))}
                aria-current={view === id ? 'page' : undefined}
                className={`h-8 cursor-pointer rounded-md px-2 text-sm sm:px-3 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-marigold ${
                  view === id ? 'bg-white/12 font-medium' : 'text-chrome-foreground/75 hover:bg-white/8 hover:text-chrome-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <span className="hidden min-w-0 max-w-56 truncate px-2 text-sm text-chrome-foreground/75 md:inline">{me.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-chrome-foreground hover:bg-white/10 hover:text-chrome-foreground"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-6 px-5 py-8 sm:px-8 sm:py-10">
        {notice && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {view === 'customers' && !me.cadence.connected && (
          <Notice>
            <p>Your account is protected by a password only.</p>
            <Button variant="outline" onClick={() => setView('security')}>
              Add Cadence
            </Button>
          </Notice>
        )}
        {view === 'customers' && <Customers onNewExport={() => (setNewExport(true), setView('exports'))} />}
        {view === 'exports' && <Exports me={me} recorder={recorder} startNew={newExport} justReleased={released} />}
        {view === 'security' && <Security me={me} onMe={setMe} pageRecorder={recorder} />}
        {view === 'account' && (
          <Account me={me} onSecurity={() => setView('security')} onDeleted={onAccountDeleted} />
        )}
      </main>
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-5 py-3.5">
      {children}
    </div>
  )
}
