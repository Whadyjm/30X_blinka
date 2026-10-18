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
import type { z } from 'zod';
import type { InvoiceTrashEvent, ChatMessageInputSchema, ChatHistorySchema, ChatConversationsSchema, ChatReply, ChatCard, ChatAction, ChatActionResult } from '@oli/contracts';
import type { EmailIntegration, Inbox, TelegramIntegration, TelegramLink } from '@oli/contracts';
import type { CreatedSkillConnection, SkillConnection, SkillIntegration } from '@oli/contracts';

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
  getTelegramIntegration(): Promise<TelegramIntegration>;
  createTelegramLink(): Promise<TelegramLink>;
  disconnectTelegram(): Promise<void>;
  getSkillIntegration(): Promise<SkillIntegration>;
  createSkillConnection(name: string): Promise<CreatedSkillConnection>;
  updateSkillConnection(id: string, expiresAt: string | null): Promise<SkillConnection>;
  revokeSkillConnection(id: string): Promise<void>;
  getEmailIntegration(): Promise<EmailIntegration>;
  enableEmail(): Promise<EmailIntegration>;
  disableEmail(): Promise<void>;
  getInbox(): Promise<Inbox>;
  listInvoiceTrash(): Promise<InvoiceTrashEvent[]>;
  setInvoiceTrash(id: string, input: { trashed: boolean; expectedEventId: string | null }): Promise<InvoiceTrashEvent>;
  readInboxMessage(id: string): Promise<void>;

  // Server-owned conversation and changes; sending a message never confirms a proposal.
  sendChatMessage(input: z.infer<typeof ChatMessageInputSchema>, operationKey: string): Promise<ChatReply>;
  listChatConversations(channel?: 'WEB' | 'TELEGRAM'): Promise<z.infer<typeof ChatConversationsSchema>>;
  getChatHistory(id: string): Promise<z.infer<typeof ChatHistorySchema>>;
  getInvoiceIntake(id: string): Promise<Extract<ChatCard, { type: 'INVOICE' }>>;
  getChatAction(id: string): Promise<ChatAction>;
  confirmChatAction(id: string): Promise<ChatActionResult>;
  cancelChatAction(id: string): Promise<ChatAction>;

  // mandate & reference data
  getMandate(): Promise<MandateState>;
  listMandateVersions(): Promise<FinanceMandate[]>;
  saveMandateDraft(input: MandateDraftInput): Promise<FinanceMandate>;
  activateMandate(input: { draftId?: string; confirm: true; expectedRevision?: number; expectedActivePolicyVersionId?: string | null }): Promise<FinanceMandate>;
  listVendors(): Promise<Vendor[]>;
  saveVendor(input: VendorInput): Promise<Vendor>;
  listAgreements(): Promise<Agreement[]>;
  saveAgreement(input: AgreementInput): Promise<Agreement>;

  // invoices
  uploadInvoice(file: File, operationKey?: string): Promise<InvoiceSummary>;
  listInvoices(opts?: { limit?: number }): Promise<InvoiceSummary[]>;
  getInvoice(id: string): Promise<InvoiceDetail>;
  /** Idempotent. Safe to call repeatedly. */
  processInvoice(id: string): Promise<void>;
  rereadInvoice(id: string, input: { expectedDecisionId: string; expectedPolicyVersionId: string }): Promise<InvoiceDetail>;
  reevaluateInvoice(id: string, input: { expectedDecisionId: string; expectedPolicyVersionId: string }): Promise<InvoiceDetail>;
  /** URL the browser can load in <img>/<object> (same-origin, cookie auth). */
  invoiceFileUrl(invoice: Pick<InvoiceDetail, 'id' | 'fileUrl'>): string;

  // approvals
  listApprovals(): Promise<ApprovalRequest[]>;
  decideApproval(id: string, input: ApprovalDecisionInput): Promise<void>;

  // evaluation
  getEvaluationSummary(): Promise<EvaluationSummary | null>;

  // P1 — Agent Access
  listAgents(): Promise<Agent[]>;
  createAgent(input: { name: string }): Promise<CreatedAgent>;
  revokeAgent(id: string): Promise<Agent>;

  // P2 — Clearance
  verifyClearance(handle: string): Promise<ClearanceVerification>;
}
