import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, UNAUTHORIZED_EVENT } from '@/api';
import { ToastProvider } from '@/components/ui/Toast';
import { I18nProvider } from '@/i18n/I18nProvider';
import { qk } from '@/hooks/queries';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Never hammer a server that said "no": retry only network/5xx, once.
        retry: (count, err) => count < 1 && err instanceof ApiError && (err.isNetwork || err.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  useEffect(() => {
    // Session expired / revoked anywhere → drop `me`; the session gate then explains there is no session.
    const onUnauthorized = () => client.setQueryData(qk.me, null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
