import { RotateCcw, Trash2 } from 'lucide-react';
import { errorMessage } from '@/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useInvoiceTrash, useMe, useSetInvoiceTrash } from '@/hooks/queries';
import { t } from '@/i18n';
import { invoiceTrashState } from '@/lib/invoice-trash';

export function InvoiceTrashButton({ invoiceId, title, compact = false }: { invoiceId: string; title: string; compact?: boolean }) {
  const me = useMe(), history = useInvoiceTrash(), change = useSetInvoiceTrash(), toast = useToast();
  if (me.data?.role !== 'owner') return null;
  const current = invoiceTrashState(history.data ?? []).get(invoiceId);
  const trashed = current?.trashed === true;
  const label = trashed ? t('Restore invoice') : t('Move to Deleted');
  return <Button variant="ghost" size="sm" icon={trashed ? <RotateCcw className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
    className="min-h-11 min-w-11" aria-label={`${label}: ${title}`} title={label} loading={change.isPending} disabled={!history.isSuccess || change.isPending}
    onClick={() => change.mutate({ id: invoiceId, trashed: !trashed, expectedEventId: current?.id ?? null }, {
      onSuccess: () => toast.success(t(trashed ? 'Invoice restored.' : 'Invoice moved to Deleted. Its records are preserved.')),
      onError: error => toast.error(errorMessage(error)),
    })}>{compact ? <span className="md:sr-only">{label}</span> : label}</Button>;
}
