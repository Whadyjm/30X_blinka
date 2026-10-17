import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState, PageLoading } from '@/components/ui/Card';
import { useMandate, useMe } from '@/hooks/queries';
import { t } from '@/i18n';

/** Requires a signed-in user. Redirects to /login otherwise. */
export function RequireAuth() {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <PageLoading label={t('Signing you in')} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} title={t('Can’t reach Oli')} />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

/** App routes need an organization with an ACTIVE policy; otherwise onboarding. */
export function RequireMandate() {
  const me = useMe();
  const mandate = useMandate(!!me.data?.org);
  if (!me.data?.org) return <Navigate to="/onboarding" replace />;
  if (mandate.isLoading) return <PageLoading />;
  if (mandate.isError) return <ErrorState error={mandate.error} onRetry={() => void mandate.refetch()} />;
  if (!mandate.data?.active) {
    if (me.data.role === 'owner') return <Navigate to="/onboarding" replace />;
    return (
      <div className="mx-auto max-w-md py-20">
        <h1 className="text-[28px] leading-[1.14]">{t('Waiting for the owner')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('Rules haven’t been activated for this organization yet. An owner needs to finish setup first.')}</p>
      </div>
    );
  }
  return <Outlet />;
}
