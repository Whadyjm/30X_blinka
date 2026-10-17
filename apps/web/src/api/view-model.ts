// The HTTP boundary uses @oli/contracts. These are presentation projections for Whady's UI.
// Names may differ; decisions, permissions, amounts and evidence always come from the server.
import type { ApprovalRequest as ApiApproval, Invoice, InvoiceDetail as ApiDetail,
  MandateDraft, PolicyDecision as ApiDecision, PolicyVersion, Session } from '@oli/contracts';
import type { ApprovalRequest, ApprovalSummary, FinanceMandate, InvoiceDetail, InvoiceSummary, Me, PolicyDecision } from '@/contracts';

export const sessionView = (s: Session): Me => ({ user: s.user, org: s.organization,
  role: s.role === 'OWNER' ? 'owner' : 'approver', demo: true });

export function policyView(p: PolicyVersion): FinanceMandate {
  return { ...p.rules, id: p.id, version: p.version, status: p.status, createdAt: p.activatedAt };
}
export function draftView(d: MandateDraft, active: PolicyVersion | null): FinanceMandate {
  return { ...d.rules, id: d.id, version: (active?.version ?? 0) + 1, status: 'DRAFT', createdAt: d.updatedAt,
    revision: d.revision, basedOnPolicyVersionId: d.basedOnPolicyVersionId };
}
// Presentation copy only; persisted explanations, evidence and identities stay intact.
const explanationView = (text: string): string => text
  .replaceAll('Bloqueada para pago simulado.', 'Bloqueada.')
  .replaceAll('aprobación simulada', 'aprobación')
  .replaceAll('Aprobación simulada', 'Aprobación');

export function decisionView(d: ApiDecision): PolicyDecision {
  return { id: d.id, invoiceId: d.invoiceId, decision: d.action, status: undefined, policyVersion: d.policyVersion,
    policyVersionId: d.policyVersionId, reasons: d.reasons, explanation: explanationView(d.humanExplanation),
    needsHumanApproval: d.needsHumanApproval, checkedAt: d.checkedAt, simulated: d.simulated,
    facts: { amountMinor: d.facts.amountMinor ?? undefined, currency: d.facts.currency ?? undefined,
      autoLimitMinor: d.facts.automaticLimitMinor, hardLimitMinor: d.facts.hardLimitMinor,
      vendorAllowed: d.facts.vendorAllowed ?? undefined, budgetRemainingMinor: d.facts.budgetAvailableBeforeMinor ?? undefined },
    trace: d.trace.map(step => ({ rule: step.rule, result: step.outcome === 'PASS' ? 'PASS' : step.outcome === 'BLOCK' ? 'FAIL' : 'WARN',
      observed: step.explanation, evidence: JSON.stringify(step.evidence), checkedAt: d.checkedAt, policyVersion: d.policyVersion })) };
}
export const approvalView = (a: ApiApproval): ApprovalSummary => ({ id: a.id, state: a.state, reason: explanationView(a.reason),
  decisionId: a.decisionId, policyVersionId: a.policyVersionId, canDecide: a.canApprove,
  reviewerId: a.reviewerId, decidedAt: a.decidedAt, justification: a.reviewComment });
export const invoiceView = (i: Invoice): InvoiceSummary => ({ id: i.id, status: i.status, source: i.source,
  fileName: i.file.name, mimeType: i.file.mimeType, fileUrl: i.file.url, receivedAt: i.createdAt,
  vendorName: i.vendorName, invoiceNumber: i.invoiceNumber, amountMinor: i.amountMinor, currency: i.currency,
  dueDate: i.dueDate, decision: i.latestDecision ? decisionView(i.latestDecision) : null,
  approval: i.approvalRequest ? approvalView(i.approvalRequest) : null, failureReason: i.processingError?.message,
  retryable: i.processingError?.retryable ?? false });
export const detailView = (i: ApiDetail): InvoiceDetail => ({ ...invoiceView(i), extracted: i.extraction,
  fileUrl: i.file.url, audit: [], decisionHistory: i.decisions.slice(0, -1).reverse().map(decisionView) });
export const requestView = (a: ApiApproval, invoice: Invoice): ApprovalRequest => ({ ...approvalView(a), id: a.id,
  invoiceId: a.invoiceId, createdAt: a.createdAt, reasons: invoice.latestDecision?.reasons ?? [], canDecide: a.canApprove,
  invoice: invoiceView(invoice) });
