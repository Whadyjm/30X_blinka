import { queryOptions } from '@tanstack/react-query';
import { api } from '@/api';

// Individual cards and lists share one live receipt per invoice, including old conversations.
export const invoiceIntakeQuery = (invoiceId: string) => queryOptions({
  queryKey: ['invoice-intake', invoiceId],
  queryFn: () => api.getInvoiceIntake(invoiceId),
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  retry: false,
  refetchInterval: query => query.state.data?.intake.status === 'PROCESSING' ? 2000 : false,
});
