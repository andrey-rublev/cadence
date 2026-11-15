import type { ActivityRecorder } from '@cadence/sdk'
import { LogOut, Shield, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CadenceBadge, Logo, Verdict } from '@/components/Brand'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api, explain, recordActivity, type CheckSummary, type Me } from '@/lib/api'
import { Customers, downloadCsv, type Customer, type Released } from '@/pages/Customers'
import { Login } from '@/pages/Login'
import { Security } from '@/pages/Security'

type View = 'customers' | 'security'

/** Where Cadence sends people back: linking (/cadence/callback) or after verifying (/cadence/return). */
async function handleReturn(): Promise<{ me?: Me; view?: View; released?: Released; error?: string } | null> {
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
        { kind: 'sign_in'; me: Me } | { kind: 'export'; customers: Customer[]; check: CheckSummary }
      >('POST', '/finish', { pending: params.get('pending') })
      if (out.kind === 'sign_in') return { me: out.me }
      downloadCsv(out.customers)
      return { released: { customers: out.customers, check: out.check } }
    }
  } catch (e) {
    return { error: explain(e) }
  }
  return null
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [view, setView] = useState<View>('customers')
  const [released, setReleased] = useState<Released | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const recorder = useRef<ActivityRecorder | null>(null)

  useEffect(() => {
    void (async () => {
      const back = await handleReturn()
      if (back?.view) setView(back.view)
      if (back?.released) setReleased(back.released)
      if (back?.error) setNotice(back.error)
      setMe(back?.me ?? (await api<Me | null>('GET', '/me').catch(() => null)))
    })()
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
    setReleased(null)
  }

  if (me === undefined) return <p className="p-8 text-muted-foreground">Loading…</p>
  if (me === null)
    return (
      <>
        {notice && (
          <Alert variant="destructive" role="alert" className="m-4 max-w-xl">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <Login onSignedIn={(m) => (setMe(m), setNotice(null))} />
      </>
    )

  const nav: { id: View; label: string; icon: typeof Users }[] = [
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'security', label: 'Security', icon: Shield },
  ]

  return (
    <div className="grid min-h-svh md:grid-cols-[15rem_1fr]">
      <aside className="flex flex-col gap-6 bg-chrome px-4 py-5 text-chrome-foreground md:min-h-svh">
        <Logo inverted />
        <nav aria-label="Northwind" className="flex gap-1 md:grid">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-base transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-marigold focus-visible:outline-none ${
                view === id ? 'bg-white/12 font-medium' : 'text-chrome-foreground/80 hover:bg-white/8'
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden gap-3 md:grid">
          {me.cadence.connected && <CadenceBadge className="text-chrome-foreground/80" />}
          <p className="truncate text-sm text-chrome-foreground/70">{me.email}</p>
          <Button variant="ghost" onClick={signOut} className="h-9 justify-start px-2 text-chrome-foreground hover:bg-white/10 hover:text-chrome-foreground">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="grid content-start gap-6 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center justify-between gap-3 md:hidden">
          <span className="truncate text-sm text-muted-foreground">{me.email}</span>
          <Button variant="outline" onClick={signOut} className="h-9 px-3">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
        {notice && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {me.sign_in_check && view === 'customers' && !released && (
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <Verdict check={me.sign_in_check} what="sign-in" />
          </div>
        )}
        {!me.cadence.connected && view === 'customers' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-marigold/60 bg-marigold/10 px-4 py-3">
            <p>Add a second check to your sign-in without extra codes: protect your account with Cadence.</p>
            <Button variant="outline" onClick={() => setView('security')} className="h-9 px-3">
              Set it up
            </Button>
          </div>
        )}
        {view === 'customers' && <Customers me={me} recorder={recorder} released={released} />}
        {view === 'security' && <Security me={me} onMe={setMe} />}
      </main>
    </div>
  )
}
