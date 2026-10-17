import { useQuery, useQueryClient } from '@tanstack/react-query';

export function useTelegramHistoryPreference(scope: string) {
  const qc = useQueryClient();
  const key = ['telegram-history-visible', scope];
  const storageKey = `oli.chat.telegram-visible:${scope}`;
  const read = () => {
    try { return !!scope && localStorage.getItem(storageKey) === 'true'; } catch { return false; }
  };
  const { data: visible = false } = useQuery({ queryKey: key, queryFn: read, initialData: read, enabled: false, staleTime: Infinity });
  return {
    visible,
    setVisible(value: boolean) {
      if (!scope) return;
      qc.setQueryData(key, value);
      try { localStorage.setItem(storageKey, String(value)); } catch { /* In-memory preference still works. */ }
    },
  };
}
