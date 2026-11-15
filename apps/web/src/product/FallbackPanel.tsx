import { api } from '@/lib/api'
import type { Me } from '@/lib/product'

import { CodeForm } from './CodeForm'

interface TrustResult {
  grant: string | null
  me: Me
}

interface FallbackPanelProps {
  /** When set, a successful verification also clears this protected-action check. */
  verificationId?: string
  onVerified: (result: TrustResult) => void
}

/** Trusted verification on the Cadence site itself, for actions such as deleting the profile. */
export function FallbackPanel({ verificationId, onVerified }: FallbackPanelProps) {
  return (
    <CodeForm
      id="trust"
      issue={async () => (await api.request<{ demo_code: string }>('POST', '/trust/start')).demo_code}
      verify={async (code) =>
        onVerified(
          await api.request<TrustResult>('POST', '/trust/verify', { code, verification_id: verificationId ?? null }),
        )
      }
    />
  )
}
