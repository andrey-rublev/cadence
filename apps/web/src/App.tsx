import { CadenceApp } from '@/cadence/CadenceApp'
import { ConnectPage } from '@/cadence/ConnectPage'
import { VerifyPage } from '@/cadence/VerifyPage'
import { CollectPage } from '@/collect/CollectPage'

/**
 * The Cadence site. `/` is sign-in, setup and the dashboard; `/connect` and `/verify/<check>`
 * are where partner sites send people; `/collect` is volunteer data collection.
 */
export default function App() {
  const path = window.location.pathname
  if (path.startsWith('/collect')) return <CollectPage />
  if (path.startsWith('/connect')) return <ConnectPage />
  const verify = path.match(/^\/verify\/([0-9a-f]{32})$/)
  if (verify) return <VerifyPage checkId={verify[1]} />
  return <CadenceApp />
}
