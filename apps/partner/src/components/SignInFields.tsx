import { ArrowLeft } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type SignInStep = 'email' | 'password'

/**
 * Email on one screen, password on the next, inside a form the caller owns (so one activity
 * recorder covers both screens). The sign-in page and the practice sign-ins use the same
 * fields, so practice typing looks like a real sign-in.
 */
export function SignInFields({
  id,
  step,
  email,
  password,
  onEmail,
  onPassword,
  onChangeEmail,
  passwordAutoComplete = 'current-password',
}: {
  id: string
  step: SignInStep
  email: string
  password: string
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onChangeEmail: () => void
  passwordAutoComplete?: string
}) {
  if (step === 'email')
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-email`}>Work email</Label>
        <Input
          id={`${id}-email`}
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          className="h-11 text-base"
        />
      </div>
    )
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <span className="truncate text-sm" aria-label="Signing in as">
          {email}
        </span>
        <button
          type="button"
          onClick={onChangeEmail}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded text-sm font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Change
        </button>
      </div>
      {/* Kept for password managers, which pair a password with the username on the same form. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-password`}>Password</Label>
        <Input
          id={`${id}-password`}
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          autoComplete={passwordAutoComplete}
          autoFocus
          required
          minLength={8}
          className="h-11 text-base"
        />
      </div>
    </>
  )
}
