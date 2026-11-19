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
  syntheticPassword = false,
  focusEmail = true,
  busy = false,
}: {
  id: string
  step: SignInStep
  email: string
  password: string
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onChangeEmail: () => void
  passwordAutoComplete?: string
  syntheticPassword?: boolean
  focusEmail?: boolean
  busy?: boolean
}) {
  if (step === 'email')
    return (
      <div className="grid gap-2">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          name="username"
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          autoComplete={syntheticPassword ? 'off' : 'username'}
          autoFocus={focusEmail}
          readOnly={busy}
          required
        />
      </div>
    )
  return (
    <>
      <div className="flex h-10 min-w-0 items-center gap-3 rounded-lg bg-muted px-3">
        <span className="min-w-0 flex-1 truncate text-sm" aria-label="Signing in as">
          {email}
        </span>
        <button
          type="button"
          onClick={onChangeEmail}
          disabled={busy}
          aria-label="Change email"
          className="shrink-0 cursor-pointer rounded text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50"
        >
          Change
        </button>
      </div>
      {/* Kept for password managers, which pair a password with the username on the same form. */}
      {!syntheticPassword && (
        <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      )}
      <div className="grid gap-2">
        <Label htmlFor={`${id}-password`}>Password</Label>
        <Input
          id={`${id}-password`}
          name="password"
          type={syntheticPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          autoComplete={syntheticPassword ? 'off' : passwordAutoComplete}
          spellCheck={syntheticPassword ? false : undefined}
          autoFocus
          readOnly={busy}
          required
          minLength={8}
        />
      </div>
    </>
  )
}
