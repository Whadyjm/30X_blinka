import type {
  Agent,
  Agreement,
  AgreementInput,
  ApprovalDecisionInput,
  ApprovalRequest,
  ClearanceVerification,
  CreateOrgInput,
  CreatedAgent,
  EvaluationSummary,
  FinanceMandate,
  InvoiceDetail,
  InvoiceSummary,
  LoginInput,
  MandateDraftInput,
  MandateState,
  Me,
  Vendor,
  VendorInput,
} from '@/contracts';

/**
 * The ONE interface the UI talks to. Two implementations:
 *   - http-api.ts  → real Worker (/api/v1)
 *   - mock/mock-api.ts → in-browser fake with the same contract
 * Pages must never import either directly; use `api` from '@/api'.
 */
export interface OliApi {
  health(): Promise<{ ok: boolean; service?: string }>;

  // session
  me(): Promise<Me | null>; // null = not authenticated
  login(input: LoginInput): Promise<Me>;
  loginDemo(): Promise<Me>;
  logout(): Promise<void>;
  createOrg(input: CreateOrgInput): Promise<Me>;

  // mandate & reference data
  getMandate(): Promise<MandateState>;
  saveMandateDraft(input: MandateDraftInput): Promise<FinanceMandate>;
  activateMandate(input: { draftId?: string; confirm: true }): Promise<FinanceMandate>;
  listVendors(): Promise<Vendor[]>;
  saveVendor(input: VendorInput): Promise<Vendor>;
  listAgreements(): Promise<Agreement[]>;
  saveAgreement(input: AgreementInput): Promise<Agreement>;

  // invoices
  uploadInvoice(file: File): Promise<InvoiceSummary>;
  listInvoices(opts?: { limit?: number }): Promise<InvoiceSummary[]>;
  getInvoice(id: string): Promise<InvoiceDetail>;
  /** Idempotent. Safe to call repeatedly. */
  processInvoice(id: string): Promise<void>;
  /** URL the browser can load in <img>/<object> (same-origin, cookie auth). */
  invoiceFileUrl(invoice: Pick<InvoiceDetail, 'id' | 'fileUrl'>): string;

  // approvals
  listApprovals(): Promise<ApprovalRequest[]>;
  decideApproval(id: string, input: ApprovalDecisionInput): Promise<void>;

  // evaluation
  getEvaluationSummary(): Promise<EvaluationSummary>;

  // P1 — Agent Access
  listAgents(): Promise<Agent[]>;
  createAgent(input: { name: string }): Promise<CreatedAgent>;
  revokeAgent(id: string): Promise<Agent>;

  // P2 — Clearance
  verifyClearance(handle: string): Promise<ClearanceVerification>;
}
