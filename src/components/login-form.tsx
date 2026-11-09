import { useState } from 'react'

import { cn } from '@/lib/utils'
import { safeNextPath } from '@/lib/safe-next-path'
import { createClient } from '@/lib/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface LoginFormProps extends React.ComponentPropsWithoutRef<'div'> {
  onSuccess?: (user?: unknown) => void
  onNavigateToSignUp?: () => void
  onNavigateToForgotPassword?: () => void
}

export function LoginForm({
  className,
  onSuccess,
  onNavigateToSignUp,
  onNavigateToForgotPassword,
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error

      if (onSuccess) {
        onSuccess(data?.user)
      } else {
        // Update this route to redirect to an authenticated route. The user already has an active session.
        const next = new URLSearchParams(window.location.search).get('next')
        location.href = safeNextPath(next, '/protected')
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card className="border-0 bg-transparent shadow-none ring-0 p-0">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="font-medium text-lg tracking-normal">Autentificare</CardTitle>
          <CardDescription>Introdu emailul și parola pentru a te conecta</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Parolă</Label>
                  {onNavigateToForgotPassword ? (
                    <button
                      type="button"
                      onClick={onNavigateToForgotPassword}
                      className="ml-auto inline-block text-sm underline-offset-4 hover:underline text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
                    >
                      Ai uitat parola?
                    </button>
                  ) : (
                    <a
                      href="/forgot-password"
                      className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </a>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Conectare...' : 'Conectează-te'}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Nu ai cont?{' '}
              {onNavigateToSignUp ? (
                <button
                  type="button"
                  onClick={onNavigateToSignUp}
                  className="underline underline-offset-4 text-foreground hover:text-primary cursor-pointer font-medium bg-transparent border-0 p-0"
                >
                  Creează cont
                </button>
              ) : (
                <a href="/sign-up" className="underline underline-offset-4">
                  Sign up
                </a>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
