import { useState } from 'react'

import { cn } from '@/lib/utils'
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

export interface ForgotPasswordFormProps extends React.ComponentPropsWithoutRef<'div'> {
  onNavigateToLogin?: () => void
}

export function ForgotPasswordForm({
  className,
  onNavigateToLogin,
  ...props
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleForgotPassword = async (e: React.FormEvent) => {
    const supabase = createClient()
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      })
      if (error) throw error
      setSuccess(true)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'A apărut o eroare')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      {success ? (
        <Card className="border-0 bg-transparent shadow-none ring-0 p-0">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="font-medium text-lg tracking-normal">Verifică emailul</CardTitle>
            <CardDescription>Instrucțiunile de resetare au fost trimise</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-0 pb-0">
            <p className="text-sm text-muted-foreground">
              Dacă adresa există, vei primi în scurt timp un email cu linkul de resetare a parolei.
            </p>
            {onNavigateToLogin && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onNavigateToLogin}
              >
                Înapoi la conectare
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 bg-transparent shadow-none ring-0 p-0">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="font-medium text-lg tracking-normal">
              Resetare parolă
            </CardTitle>
            <CardDescription>
              Introdu adresa de email pentru a primi linkul de resetare
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <form onSubmit={handleForgotPassword}>
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
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Se trimite...' : 'Trimite link de resetare'}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm text-muted-foreground">
                Ai deja cont?{' '}
                {onNavigateToLogin ? (
                  <button
                    type="button"
                    onClick={onNavigateToLogin}
                    className="underline underline-offset-4 text-foreground hover:text-primary cursor-pointer font-medium bg-transparent border-0 p-0"
                  >
                    Conectează-te
                  </button>
                ) : (
                  <a href="/login" className="underline underline-offset-4">
                    Sign in
                  </a>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
