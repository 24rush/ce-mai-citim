import { useState } from 'react'
import { LoginForm } from '@/components/login-form'
import { SignUpForm } from '@/components/sign-up-form'
import { ForgotPasswordForm } from '@/components/forgot-password-form'
import { isSupabaseConfigured } from '@/lib/client'

export default function AuthModalView({ onSuccess }) {
  const [view, setView] = useState('login')
  const configured = isSupabaseConfigured()

  return (
    <div className="w-full flex flex-col gap-4">
      {!configured ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="font-semibold mb-1">Configurare Supabase necesară</p>
          <p className="text-amber-200/80">
            Adaugă <code>VITE_SUPABASE_URL</code> și <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> în fișierul <code>.env.local</code> pentru a conecta proiectul Supabase.
          </p>
        </div>
      ) : null}

      {view === 'login' && (
        <LoginForm
          onSuccess={onSuccess}
          onNavigateToSignUp={() => setView('sign-up')}
          onNavigateToForgotPassword={() => setView('forgot-password')}
        />
      )}

      {view === 'sign-up' && (
        <SignUpForm
          onSuccess={onSuccess}
          onNavigateToLogin={() => setView('login')}
        />
      )}

      {view === 'forgot-password' && (
        <ForgotPasswordForm
          onNavigateToLogin={() => setView('login')}
        />
      )}
    </div>
  )
}

