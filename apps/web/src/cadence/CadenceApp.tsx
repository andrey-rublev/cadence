import { useEffect, useRef, useState } from 'react'

import { Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { Me } from '@/lib/product'
import { PassiveProvider } from '@/product/PassiveCapture'

import { Dashboard } from './Dashboard'
import { Setup } from './Setup'
import { SignIn } from './SignIn'

/** The Cadence site: sign in, set up (consent, click test, typing test), then the dashboard. */
export function CadenceApp() {
  /** `undefined` while the first check is in flight; `null` when signed out. */
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const root = useRef<HTMLElement>(document.body)
  // Setup keeps the page until its closing screen is left, not just until the last sample lands.
  const [settingUp, setSettingUp] = useState(false)
  if (me && !me.setup.complete && !settingUp) setSettingUp(true)
  if (!me && settingUp) setSettingUp(false)

  useEffect(() => {
    api.request<Me | null>('GET', '/me').then(setMe, () => setMe(null))
  }, [])

  async function signOut() {
    await api.request('POST', '/auth/logout').catch(() => undefined)
    setMe(null)
  }

  return (
    <PassiveProvider me={me} setMe={setMe} root={root}>
      <Shell
        actions={
          me && (
            <div className="flex items-center gap-1">
              <span className="hidden px-2 text-sm text-muted-foreground sm:inline">{me.username}</span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          )
        }
      >
        {me === null && <SignIn onSignedIn={setMe} />}
        {me && settingUp && <Setup me={me} onMe={setMe} onFinish={() => setSettingUp(false)} />}
        {me && !settingUp && <Dashboard me={me} onMe={setMe} />}
      </Shell>
    </PassiveProvider>
  )
}
