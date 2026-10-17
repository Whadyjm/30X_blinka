import { Navigate, Outlet } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ErrorState, PageLoading } from '@/components/ui/Card';
import { useMandate, useMe } from '@/hooks/queries';
import { t } from '@/i18n';

/**
 * Session gate. There is no sign-in screen in this build:
 *  - mock mode always has a session, so this passes straight through;
 *  - live mode needs the API to already hold a session (cookie). Without one the UI fails closed
 *    with an explanation instead of rendering screens whose every request would be a 401.
 */
export function RequireSession() {
  const me = useMe();
  if (me.isLoading) return <PageLoading label={t('Signing you in')} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} title={t('Can’t reach Oli')} />;
  if (!me.data) return <NoSession onRetry={() => void me.refetch()} />;
  return <Outlet />;
}

function NoSession({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-[28px] leading-[1.14]">{t('No active session')}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {t('The API requires a session and this build has no sign-in screen. Start the API with a session, or run the UI on the mock data (npm run dev:mock).')}
      </p>
      <Button className="mt-6" variant="secondary" onClick={onRetry}>
        {t('Try again')}
      </Button>
    </div>
  );
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
