import { LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Me } from '@/lib/product'

import { CustomersView } from './CustomersView'
import { CaptureIndicator, PassiveProvider } from './PassiveCapture'
import { ProfileView } from './ProfileView'
import { SignIn } from './SignIn'

type View = 'customers' | 'profile'

const VIEWS: { id: View; label: string }[] = [
  { id: 'customers', label: 'Customers' },
  { id: 'profile', label: 'Behaviour profile' },
]

const profileReady = (me: Me) => me.passive.keys.sufficient || me.passive.pointer.sufficient

export function ProductApp() {
  /** `undefined` while the first check is in flight; `null` when signed out. */
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [view, setView] = useState<View>('customers')
  // The whole page, not just the main column: dialogs (the export check) render at the end
  // of <body>, and activity inside them must count too.
  const root = useRef<HTMLElement>(document.body)

  useEffect(() => {
    api.request<Me | null>('GET', '/me').then(setMe, () => setMe(null))
  }, [])

  async function signOut() {
    await api.request('POST', '/auth/logout').catch(() => undefined)
    setMe(null)
    setView('customers')
  }

  return (
    <PassiveProvider me={me} setMe={setMe} root={root}>
      <div
        className="mx-auto grid min-h-svh w-full max-w-6xl grid-rows-[auto_1fr] gap-8 px-5 py-6 sm:px-8 sm:py-8"
      >
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Wordmark />
          {me && (
            <>
              <nav aria-label="Workspace" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
                {VIEWS.map(({ id, label }) => (
                  <Button
                    key={id}
                    variant={view === id ? 'secondary' : 'ghost'}
                    aria-current={view === id ? 'page' : undefined}
                    onClick={() => setView(id)}
                    className="h-10 px-4 text-base"
                  >
                    {label}
                    {id === 'profile' && !profileReady(me) && (
                      <span className="size-2 rounded-full bg-primary" aria-label="not finished" />
                    )}
                  </Button>
                ))}
              </nav>
              <div className="flex flex-wrap items-center gap-3">
                <CaptureIndicator me={me} onOpenProfile={() => setView('profile')} />
                <span className="font-mono text-sm text-muted-foreground">{me.username}</span>
                <Button variant="outline" onClick={signOut} className="h-10 px-3 text-base">
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            </>
          )}
        </header>

        <main className="grid content-start gap-6">
          {me === null && <SignIn onSignedIn={setMe} />}
          {me && view === 'customers' && (
            <CustomersView me={me} onMe={setMe} onSetUpProfile={() => setView('profile')} onSignOut={signOut} />
          )}
          {me && view === 'profile' && <ProfileView me={me} onMe={setMe} />}
        </main>
      </div>
    </PassiveProvider>
  )
}
