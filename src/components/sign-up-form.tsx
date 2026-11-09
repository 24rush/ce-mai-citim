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

export interface SignUpFormProps extends React.ComponentPropsWithoutRef<'div'> {
  onSuccess?: (user?: unknown) => void
  onNavigateToLogin?: () => void
}

export function SignUpForm({
  className,
  onSuccess,
  onNavigateToLogin,
  ...props
}: SignUpFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    const supabase = createClient()
    e.preventDefault()
    setError(null)

    if (password !== repeatPassword) {
      setError('Parolele nu se potrivesc')
      return
    }
    setIsLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      })
      if (error) throw error

      if (data?.session && onSuccess) {
        onSuccess(data?.user)
      } else {
        setSuccess(true)
      }
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
            <CardTitle className="font-medium text-lg tracking-normal">
              Cont creat cu succes!
            </CardTitle>
            <CardDescription>Verifică emailul pentru confirmare</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-0 pb-0">
            <p className="text-sm text-muted-foreground">
              Ți-am trimis un link de confirmare pe email ({email}). Confirmă adresa pentru a te conecta.
            </p>
            {onNavigateToLogin && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onNavigateToLogin}
              >
                Mergi la autentificare
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 bg-transparent shadow-none ring-0 p-0">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="font-medium text-lg tracking-normal">Înregistrare</CardTitle>
            <CardDescription>Creează un cont nou pentru biblioteca ta</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <form onSubmit={handleSignUp}>
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
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="repeat-password">Repetă parola</Label>
                  </div>
                  <Input
                    id="repeat-password"
                    type="password"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Se creează contul...' : 'Creează cont'}
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
