import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api, ApiError } from '@/api';
import type { ApprovalDecisionInput, FinanceMandate, MandateDraftInput } from '@/contracts';
import { isInFlight } from '@/lib/outcome';
import type { AgreementInput, VendorInput } from '@/contracts';

export const qk = {
  inbox: ['inbox'] as const,
  me: ['me'] as const,
  mandate: ['mandate'] as const,
  vendors: ['vendors'] as const,
  agreements: ['agreements'] as const,
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoice', id] as const,
  approvals: ['approvals'] as const,
  evaluation: ['evaluation'] as const,
  agents: ['agents'] as const,
};

const POLL_MS = 2000;
const POLL_WINDOW_MS = 60000;

export function useInbox() {
  return useQuery({ queryKey: qk.inbox, queryFn: () => api.getInbox(), refetchInterval: 5000, retry: false });
}

export function useReadInboxMessage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.readInboxMessage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.inbox }) });
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api.me(), staleTime: 60_000, retry: false });
}

export function useMandate(enabled = true) {
  return useQuery({ queryKey: qk.mandate, queryFn: () => api.getMandate(), enabled });
}

export function useVendors(enabled = true) {
  return useQuery({ queryKey: qk.vendors, queryFn: () => api.listVendors(), enabled });
}

export function useAgreements(enabled = true) {
  return useQuery({ queryKey: qk.agreements, queryFn: () => api.listAgreements(), enabled });
}

/** Polls while anything is still being processed, then stops by itself. */
export function useInvoices() {
  const started = useRef<number | null>(null);
  const query = useQuery({
    queryKey: qk.invoices,
    queryFn: () => api.listInvoices(),
    refetchInterval: (q) => {
      if (!q.state.data?.some(isInFlight)) { started.current = null; return false; }
      started.current ??= Date.now();
      return Date.now() - started.current < POLL_WINDOW_MS ? POLL_MS : false;
    },
  });
  return { ...query, refresh: () => { started.current = Date.now(); return query.refetch(); } };
}

export function useInvoice(id: string) {
  const started = useRef<number | null>(null);
  const query = useQuery({
    queryKey: qk.invoice(id),
    queryFn: () => api.getInvoice(id),
    refetchInterval: (q) => {
      if (!q.state.data || !isInFlight(q.state.data)) { started.current = null; return false; }
      started.current ??= Date.now();
      return Date.now() - started.current < POLL_WINDOW_MS ? POLL_MS : false;
    },
  });
  return { ...query, refresh: () => { started.current = Date.now(); return query.refetch(); } };
}

export function useProcessInvoice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.processInvoice(id), onSettled: () => invalidateMoney(qc) });
}

export function useReevaluateInvoice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { id: string; expectedDecisionId: string; expectedPolicyVersionId: string }) =>
    api.reevaluateInvoice(input.id, { expectedDecisionId: input.expectedDecisionId, expectedPolicyVersionId: input.expectedPolicyVersionId }),
    onSettled: () => invalidateMoney(qc) });
}

export function useApprovals(enabled = true) {
  return useQuery({ queryKey: qk.approvals, queryFn: () => api.listApprovals(), staleTime: 10_000, enabled });
}

export function useEvaluation() {
  return useQuery({ queryKey: qk.evaluation, queryFn: () => api.getEvaluationSummary() });
}

/** After anything that can change a decision, budget or approval state. */
export function invalidateMoney(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.invoices }),
    qc.invalidateQueries({ queryKey: ['invoice'] }),
    qc.invalidateQueries({ queryKey: qk.approvals }),
    qc.invalidateQueries({ queryKey: qk.mandate }),
    qc.invalidateQueries({ queryKey: qk.evaluation }),
  ]);
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApprovalDecisionInput }) => api.decideApproval(id, input),
    // A 409 means the server re-checked and refused: state changed, so refresh either way.
    onSettled: () => invalidateMoney(qc),
  });
}

export function useSaveMandateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MandateDraftInput) => api.saveMandateDraft(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.mandate }),
  });
}

export function useActivateMandate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft?: FinanceMandate) => api.activateMandate({ draftId: draft?.id, confirm: true,
      expectedRevision: draft?.revision, expectedActivePolicyVersionId: draft?.basedOnPolicyVersionId ?? null }),
    onSuccess: () => invalidateMoney(qc),
  });
}

export function useSaveVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VendorInput) => api.saveVendor(input),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: qk.vendors }), qc.invalidateQueries({ queryKey: qk.agreements })]),
  });
}

export function useSaveAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgreementInput) => api.saveAgreement(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agreements }),
  });
}

/** Did the server refuse because re-validation failed? (409 REVALIDATION_FAILED) */
export function isRevalidationFailure(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409;
}
