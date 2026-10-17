import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { Card, InlineAlert } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { brand } from '@/config/brand';
import { env } from '@/config/env';
import { qk, useMe } from '@/hooks/queries';
import { t } from '@/i18n';

export function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const me = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = (loc.state as { from?: string } | null)?.from ?? '/app';
  if (me.data) return <Navigate to={from} replace />;

  const run = async (kind: 'login' | 'demo') => {
    setBusy(kind);
    setError(null);
    try {
      const m = kind === 'demo' ? await api.loginDemo() : await api.login({ email: email.trim(), password });
      qc.setQueryData(qk.me, m);
      nav(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <LanguageSwitcher />
      </div>
      <div className="grid flex-1 place-items-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-start gap-2">
            <Logo />
            <p className="text-sm text-ash">{brand.tagline}</p>
          </div>
          <Card className="p-6">
            {env.apiMode === 'mock' ? <>
            <Button size="lg" beam className="w-full" loading={busy === 'demo'} disabled={busy !== null} onClick={() => void run('demo')}>
              {t('Try Oli')}
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-hairline" /> {t('or sign in')} <span className="h-px flex-1 bg-hairline" />
            </div>
            </> : <p className="mb-5 text-sm text-ash">{t('Sign in to manage your invoices.')}</p>}

            <form onSubmit={submit} className="space-y-4" noValidate>
              <TextField label={t('Email or username')} type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <TextField label={t('Password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              {error && <InlineAlert>{error}</InlineAlert>}
              <Button type="submit" variant="secondary" className="w-full" loading={busy === 'login'} disabled={busy !== null || !email || !password}>
                {t('Sign in')}
              </Button>
            </form>

            {env.apiMode === 'mock' && (
              <p className="mt-4 rounded-md bg-bone p-2.5 text-xs text-slate-500">
                {t('Access credentials:')} <code>demo@oli.test</code> / <code>oli-demo-2026</code>
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
