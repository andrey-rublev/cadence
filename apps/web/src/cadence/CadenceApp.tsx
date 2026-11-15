import { LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Me } from '@/lib/product'
import { CaptureIndicator, PassiveProvider } from '@/product/PassiveCapture'

import { Dashboard } from './Dashboard'
import { Setup } from './Setup'
import { SignIn } from './SignIn'

/** The Cadence site: sign in, set up (click test, typing test, sign-ins), then the dashboard. */
export function CadenceApp() {
  /** `undefined` while the first check is in flight; `null` when signed out. */
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const root = useRef<HTMLElement>(document.body)

  useEffect(() => {
    api.request<Me | null>('GET', '/me').then(setMe, () => setMe(null))
  }, [])

  async function signOut() {
    await api.request('POST', '/auth/logout').catch(() => undefined)
    setMe(null)
  }

  return (
    <PassiveProvider me={me} setMe={setMe} root={root}>
      <div className="mx-auto grid min-h-svh w-full max-w-6xl grid-rows-[auto_1fr] gap-8 px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Wordmark />
          {me && (
            <div className="flex flex-wrap items-center gap-3">
              <CaptureIndicator me={me} onOpenProfile={() => undefined} />
              <span className="font-mono text-sm text-muted-foreground">{me.username}</span>
              <Button variant="outline" onClick={signOut} className="h-10 px-3 text-base">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </div>
          )}
        </header>
        <main className="grid content-start gap-6">
          {me === null && <SignIn onSignedIn={setMe} />}
          {me && !me.setup.complete && <Setup me={me} onMe={setMe} />}
          {me && me.setup.complete && <Dashboard me={me} onMe={setMe} />}
        </main>
      </div>
    </PassiveProvider>
  )
}
