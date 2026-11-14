import type { ChallengeResult, Layout } from './types'

export interface IssuedChallenge {
  id: string
  expires_in_ms: number
  is_warmup: boolean
  layout: Layout
}

/** A non-2xx response. `code` is the server's machine-readable reason. */
export class CadenceApiError extends Error {
  status: number
  code: string
  detail: unknown

  constructor(status: number, detail: unknown) {
    const code =
      typeof detail === 'string'
        ? detail
        : ((detail as { code?: string } | null)?.code ?? 'request_failed')
    super(code)
    this.name = 'CadenceApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export interface CadenceClient {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>
  issueChallenge(): Promise<IssuedChallenge>
  submitChallenge<T>(id: string, result: ChallengeResult): Promise<T>
}

/** Same-origin API client. Sends the session cookie and the header the server requires on writes. */
export function createClient(endpoint = '/api'): CadenceClient {
  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Cadence-Client': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 204) return undefined as T
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new CadenceApiError(response.status, payload?.detail ?? null)
    return payload as T
  }

  return {
    request,
    issueChallenge: () => request('POST', '/challenges'),
    submitChallenge: (id, result) => request('POST', `/challenges/${id}/submit`, result),
  }
}
