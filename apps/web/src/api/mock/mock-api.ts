/**
 * MOCK API — implements the exact same `OliApi` as the HTTP client, in the browser.
 * Purpose: build/demo the UI with zero backend. Dynamically imported, so it is NOT in `live` bundles
 * unless VITE_API_MODE=mock. Decisions here come from a *mock* engine; they prove nothing about safety.
 */
import type {
  Agent,
  Agreement,
  ApprovalDecisionInput,
  ApprovalRequest,
  Decision,
  EvaluationSummary,
  ExtractedInvoice,
  FinanceMandate,
  InvoiceDetail,
  InvoiceSummary,
  MandateState,
  Me,
  PolicyDecision,
  Role,
  Vendor,
} from '@/contracts';
import { UPLOAD } from '@/config/env';
import { ApiError } from '../errors';
import type { OliApi } from '../types';
import { mockEvaluate, type EngineContext } from './engine';
import {
  DEMO_PASSWORD,
  SCENARIOS,
  SEED_AGENTS,
  SEED_AGREEMENTS,
  SEED_MANDATE,
  SEED_ORG,
  SEED_USER,
  SEED_VENDORS,
} from './seed';

/* ───────────────────────── state ───────────────────────── */

type ApprovalRow = {
  id: string;
  invoiceId: string;
  state: string;
  reason: string;
  reasons: string[];
  createdAt: string;
  reviewerName?: string | null;
  decidedAt?: string | null;
  justification?: string | null;
};

type Meta = { t0: number; scenario: string; fileName: string | null; agentName: string | null; agentRevoked: boolean; extractedFinal: ExtractedInvoice | null };

type Db = {
  signedIn: boolean;
  org: { id: string; name: string; defaultCurrency: string } | null;
  role: Role;
  mandateActive: FinanceMandate | null;
  mandateDraft: FinanceMandate | null;
  vendors: Vendor[];
  agreements: Agreement[];
  agents: Agent[];
  invoices: InvoiceDetail[];
  approvals: ApprovalRow[];
  meta: Record<string, Meta>;
  reservedMinor: number;
  seq: number;
};

const KEY = 'oli.mock.v1';
const STAGE = { parsing: 400, processing: 1300, decide: 2000 };

let db: Db | null = null;
const fileUrls = new Map<string, string>();

const storage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

function persist() {
  if (db) storage()?.setItem(KEY, JSON.stringify(db));
}

function nowIso() {
  return new Date().toISOString();
}

function getDb(): Db {
  if (db) return db;
  const raw = storage()?.getItem(KEY);
  if (raw) {
    try {
      db = JSON.parse(raw) as Db;
      return db;
    } catch {
      /* fall through to reseed */
    }
  }
  db = seed();
  persist();
  return db;
}

function emptyDb(): Db {
  return {
    signedIn: false,
    org: null,
    role: 'owner',
    mandateActive: null,
    mandateDraft: null,
    vendors: [],
    agreements: [],
    agents: [],
    invoices: [],
    approvals: [],
    meta: {},
    reservedMinor: 0,
    seq: 100,
  };
}

/* ───────────────────────── helpers ───────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lag = () => sleep(120 + Math.random() * 180);

function auth(): Db {
  // No sign-in screen: the mock always has a session. (`signedIn` is kept only for persisted DBs.)
  return getDb();
}

function requireOwner(d: Db) {
  if (d.role !== 'owner') throw new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Only an owner can change the mandate.' });
}

function nextId(d: Db, prefix: string) {
  d.seq += 1;
  return `${prefix}_${String(d.seq).padStart(4, '0')}`;
}

function budgetRemaining(d: Db): number {
  return (d.mandateActive?.monthlyBudgetMinor ?? 0) - d.reservedMinor;
}

function ctxFor(d: Db, excludeId: string | null, agentRevoked = false, at = nowIso()): EngineContext {
  return {
    mandate: d.mandateActive as FinanceMandate,
    vendors: d.vendors,
    agreements: d.agreements,
    existing: d.invoices.filter((i) => i.id !== excludeId && i.status !== 'RECEIVED' && i.extracted),
    budgetRemainingMinor: budgetRemaining(d),
    budgetCurrency: d.mandateActive?.currency ?? 'USD',
    agentRevoked,
    nowIso: at,
  };
}

function syncFields(inv: InvoiceDetail) {
  const x = inv.extracted;
  inv.vendorName = x?.vendorName ?? null;
  inv.invoiceNumber = x?.invoiceNumber ?? null;
  inv.amountMinor = x?.amountMinor ?? null;
  inv.currency = x?.currency ?? null;
  inv.dueDate = x?.dueDate ?? null;
}

function audit(inv: InvoiceDetail, type: string, actorKind: string, actorName: string | null, details?: Record<string, unknown>, at = nowIso()) {
  inv.audit.push({ id: `evt_${inv.audit.length + 1}_${inv.id}`, type, actorKind, actorName, actorId: null, createdAt: at, details: details ?? null });
}

/** Run the mock engine and append the result (append-only). */
function decide(d: Db, inv: InvoiceDetail, at: string) {
  const meta = d.meta[inv.id];
  const agentRevoked = !!meta?.agentRevoked;
  const decision = mockEvaluate(inv.extracted as ExtractedInvoice, ctxFor(d, inv.id, agentRevoked, at), d.mandateActive?.version ?? 1);
  decision.id = nextId(d, 'dec');
  decision.policyVersionId = d.mandateActive?.id;
  if (inv.decision) inv.decisionHistory.unshift(inv.decision);
  inv.decision = decision;
  inv.status = decision.decision === 'APPROVE' ? 'APPROVED' : decision.decision === 'BLOCK' ? 'BLOCKED' : 'NEEDS_APPROVAL';
  audit(inv, 'DECISION_RECORDED', 'system', 'Oli policy engine (mock)', { decision: decision.decision, reasons: decision.reasons, policyVersion: decision.policyVersion }, at);

  if (decision.decision === 'APPROVE') {
    d.reservedMinor += inv.amountMinor ?? 0;
    audit(inv, 'BUDGET_RESERVED', 'system', null, { amountMinor: inv.amountMinor }, at);
  }
  if (decision.decision === 'ESCALATE' && decision.needsHumanApproval) {
    const id = nextId(d, 'apr');
    d.approvals.push({ id, invoiceId: inv.id, state: 'PENDING', reason: decision.explanation, reasons: decision.reasons, createdAt: at });
    inv.approval = { id, state: 'PENDING', reason: decision.explanation };
    audit(inv, 'APPROVAL_REQUESTED', 'system', null, { approvalId: id }, at);
  }
}

/** Time-driven pipeline: RECEIVED → PARSING → PROCESSING → DECIDED. Evaluated lazily on every read. */
function advance(d: Db, inv: InvoiceDetail) {
  const meta = d.meta[inv.id];
  if (!meta || !['RECEIVED', 'PARSING', 'PROCESSING'].includes(inv.status)) return;
  const elapsed = Date.now() - meta.t0;
  let changed = false;
  if (elapsed >= STAGE.processing && !inv.extracted && meta.extractedFinal) {
    inv.extracted = meta.extractedFinal;
    syncFields(inv);
    audit(inv, 'EXTRACTION_COMPLETED', 'system', 'Document reader (mock)', { warnings: meta.extractedFinal.extractionWarnings });
    changed = true;
  }
  if (elapsed >= STAGE.decide) {
    decide(d, inv, nowIso());
    changed = true;
  } else {
    const s = elapsed >= STAGE.processing ? 'PROCESSING' : elapsed >= STAGE.parsing ? 'PARSING' : 'RECEIVED';
    if (s !== inv.status) {
      inv.status = s;
      changed = true;
    }
  }
  if (changed) persist();
}

function toSummary(inv: InvoiceDetail): InvoiceSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { extracted, audit: _a, decisionHistory: _h, fileSha256: _f, fileUrl: _u, ...rest } = inv;
  void extracted;
  return rest;
}

async function sha256(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${file.name}-${file.size}`;
  }
}

function pickScenario(name: string) {
  const n = name.toLowerCase();
  return SCENARIOS.find((s) => n.includes(s.key)) ?? SCENARIOS[0]!;
}

/* ───────────────────────── seed ───────────────────────── */

function ago(days: number, hours = 0) {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
}
function dayOffset(n: number) {
  const x = new Date();
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function seed(): Db {
  const d = emptyDb();
  d.org = { ...SEED_ORG };
  d.mandateActive = { ...SEED_MANDATE, version: 1, id: 'pol_1', status: 'ACTIVE', createdAt: ago(3), createdByName: SEED_USER.name };
  d.vendors = structuredClone(SEED_VENDORS);
  d.agreements = structuredClone(SEED_AGREEMENTS);
  d.agents = structuredClone(SEED_AGENTS);

  const rows: Array<{ x: Partial<ExtractedInvoice> & Pick<ExtractedInvoice, 'vendorName' | 'invoiceNumber' | 'amountMinor'>; due: number; age: [number, number]; agent?: string; file: string }> = [
    { x: { vendorName: 'Acme Cloud Services', invoiceNumber: 'INV-ACME-1038', amountMinor: 32_000, description: 'Cloud hosting' }, due: 6, age: [5, 0], file: 'acme-1038.pdf' },
    { x: { vendorName: 'Brightline Office Supply', invoiceNumber: 'INV-BRT-220', amountMinor: 40_000, description: 'Office supplies' }, due: 9, age: [4, 3], file: 'brightline-220.pdf' },
    { x: { vendorName: 'Cedar Logistics', invoiceNumber: 'INV-CED-0907', amountMinor: 15_000, description: 'Courier services' }, due: 3, age: [3, 1], agent: 'Procurement Agent', file: 'cedar-0907.pdf' },
    { x: { vendorName: 'Atlas Consulting', invoiceNumber: 'INV-AT-5001', amountMinor: 85_000, description: 'Advisory retainer' }, due: 4, age: [2, 5], file: 'atlas-5001-over-limit.pdf' },
    { x: { vendorName: 'Brightline Office Supply', invoiceNumber: 'INV-BRT-231', amountMinor: 47_500, description: 'Office supplies' }, due: 10, age: [1, 8], file: 'brightline-231-mismatch.pdf' },
    { x: { vendorName: 'Shadow Ventures LLC', invoiceNumber: 'SV-0001', amountMinor: 21_000 }, due: 7, age: [1, 2], file: 'shadow-0001.png' },
    { x: { vendorName: 'Acme Cloud Services', invoiceNumber: 'INV-ACME-1038', amountMinor: 32_000, description: 'Cloud hosting' }, due: 6, age: [0, 3], file: 'acme-1038-again.pdf' },
  ];

  rows.forEach((r, i) => {
    const id = `inv_demo_${String(i + 1).padStart(4, '0')}`;
    const at = ago(r.age[0], r.age[1]);
    const extracted: ExtractedInvoice = {
      currency: 'USD',
      issuedAt: dayOffset(-5),
      dueDate: dayOffset(r.due),
      description: null,
      extractionWarnings: [],
      evidence: [],
      ...r.x,
    };
    const inv: InvoiceDetail = {
      id,
      source: r.agent ? 'AGENT_REQUEST' : 'HUMAN_UPLOAD',
      requestingAgentName: r.agent ?? null,
      fileName: r.file,
      mimeType: r.file.endsWith('.png') ? 'image/png' : 'application/pdf',
      status: 'PROCESSING',
      receivedAt: at,
      extracted,
      fileSha256: null,
      fileUrl: null,
      audit: [],
      decisionHistory: [],
      decision: null,
      approval: null,
      failureReason: null,
      vendorName: null,
      invoiceNumber: null,
      amountMinor: null,
      currency: null,
      dueDate: null,
    };
    syncFields(inv);
    audit(inv, 'INVOICE_RECEIVED', r.agent ? 'agent' : 'user', r.agent ?? SEED_USER.name, { fileName: r.file }, at);
    audit(inv, 'EXTRACTION_COMPLETED', 'system', 'Document reader (mock)', {}, at);
    d.invoices.push(inv);
    d.meta[id] = { t0: 0, scenario: 'seed', fileName: r.file, agentName: r.agent ?? null, agentRevoked: false, extractedFinal: extracted };
    decide(d, inv, at);
  });
  d.invoices.reverse(); // newest first
  d.signedIn = false;
  return d;
}

/* ───────────────────────── public mock controls ───────────────────────── */

export const mockControls = {
  /** Wipe everything and start again from the seeded demo org. */
  reset() {
    storage()?.removeItem(KEY);
    db = seed();
    persist();
  },
  /** Signed-in owner with NO organization → shows the onboarding flow. */
  startOnboarding() {
    const fresh = emptyDb();
    fresh.signedIn = true;
    db = fresh;
    persist();
  },
  /** For tests: use a throwaway in-memory db. */
  _resetMemory(kind: 'seed' | 'empty' = 'seed') {
    db = kind === 'seed' ? seed() : emptyDb();
  },
};

/* ───────────────────────── api ───────────────────────── */

function meOf(d: Db): Me {
  return { user: { ...SEED_USER }, org: d.org, role: d.org ? d.role : null, demo: true };
}

export const mockApi: OliApi = {
  async getEmailIntegration() { return { available: false, mailbox: null }; },
  async enableEmail() { throw new ApiError({ status: 503, code: 'EMAIL_NOT_CONFIGURED', message: 'Email is temporarily unavailable.' }); },
  async disableEmail() {},
  async getInbox() { return { messages: [], unreadCount: 0 }; },
  async readInboxMessage() {},
  async getTelegramIntegration() { return { available: false, connection: null }; },
  async createTelegramLink() { throw new ApiError({ status: 503, code: 'TELEGRAM_NOT_CONFIGURED', message: 'Telegram requires a connection to the Oli server.' }); },
  async disconnectTelegram() {},
  async health() {
    return { ok: true, service: 'oli-mock' };
  },

  async me() {
    await lag();
    return meOf(getDb());
  },
  async login(input) {
    await lag();
    if (input.email.trim().toLowerCase() !== SEED_USER.email || input.password !== DEMO_PASSWORD) {
      throw new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    const d = getDb();
    d.signedIn = true;
    persist();
    return meOf(d);
  },
  async loginDemo() {
    await lag();
    const d = getDb();
    d.signedIn = true;
    persist();
    return meOf(d);
  },
  async logout() {
    await lag();
    const d = getDb();
    d.signedIn = false;
    persist();
  },
  async createOrg(input) {
    await lag();
    const d = auth();
    d.org = { id: 'org_new', name: input.name, defaultCurrency: input.defaultCurrency };
    d.role = 'owner';
    persist();
    return meOf(d);
  },

  async getMandate(): Promise<MandateState> {
    await lag();
    const d = auth();
    const active = d.mandateActive;
    return {
      active,
      draft: d.mandateDraft,
      budget: active
        ? {
            periodKey: new Date().toISOString().slice(0, 7),
            currency: active.currency,
            limitMinor: active.monthlyBudgetMinor,
            reservedMinor: d.reservedMinor,
          }
        : null,
    };
  },
  async saveMandateDraft(input) {
    await lag();
    const d = auth();
    requireOwner(d);
    if (input.automaticLimitMinor > input.hardLimitMinor) {
      throw new ApiError({ status: 422, code: 'INVALID_MANDATE', message: 'The automatic limit cannot be higher than the absolute limit.' });
    }
    d.mandateDraft = { ...input, version: (d.mandateActive?.version ?? 0) + 1, id: 'pol_draft', status: 'DRAFT', createdAt: nowIso(), createdByName: SEED_USER.name };
    persist();
    return d.mandateDraft;
  },
  async activateMandate() {
    await lag();
    const d = auth();
    requireOwner(d);
    if (!d.mandateDraft) throw new ApiError({ status: 409, code: 'NO_DRAFT', message: 'There is no draft to activate.' });
    d.mandateActive = { ...d.mandateDraft, status: 'ACTIVE', id: `pol_${d.mandateDraft.version}`, createdAt: nowIso() };
    d.mandateDraft = null;
    persist();
    return d.mandateActive;
  },
  async listVendors() {
    await lag();
    return auth().vendors;
  },
  async saveVendor(input) {
    await lag();
    const d = auth();
    requireOwner(d);
    const existing = input.id ? d.vendors.find((v) => v.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, { name: input.name, allowed: input.allowed, externalRef: input.externalRef ?? null });
      persist();
      return existing;
    }
    const v: Vendor = { id: nextId(d, 'ven'), name: input.name, allowed: input.allowed, externalRef: input.externalRef ?? null };
    d.vendors.push(v);
    persist();
    return v;
  },
  async listAgreements() {
    await lag();
    const d = auth();
    return d.agreements.map((a) => ({ ...a, vendorName: d.vendors.find((v) => v.id === a.vendorId)?.name ?? null }));
  },
  async saveAgreement(input) {
    await lag();
    const d = auth();
    requireOwner(d);
    const vendor = d.vendors.find((v) => v.id === input.vendorId);
    if (!vendor) throw new ApiError({ status: 422, code: 'UNKNOWN_VENDOR', message: 'Choose an existing vendor.' });
    const existing = input.id ? d.agreements.find((a) => a.id === input.id) : undefined;
    const row: Agreement = {
      id: existing?.id ?? nextId(d, 'agr'),
      vendorId: vendor.id,
      vendorName: vendor.name,
      currency: input.currency,
      amountMinor: input.amountMinor,
      toleranceMinor: input.toleranceMinor,
      frequency: input.frequency,
      concept: input.concept ?? null,
      active: input.active,
    };
    if (existing) Object.assign(existing, row);
    else d.agreements.push(row);
    persist();
    return row;
  },

  async uploadInvoice(file) {
    await lag();
    const d = auth();
    if (!d.mandateActive) throw new ApiError({ status: 409, code: 'NO_ACTIVE_POLICY', message: 'Activate your rules before uploading invoices.' });
    if (!UPLOAD.mimeTypes.includes(file.type)) {
      throw new ApiError({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Only PDF, PNG or JPEG files are accepted.' });
    }
    if (file.size > UPLOAD.maxBytes) {
      throw new ApiError({ status: 413, code: 'FILE_TOO_LARGE', message: 'Files are limited to 5 MB.' });
    }
    const hash = await sha256(file);
    const scenario = pickScenario(file.name);
    // Same bytes ⇒ same invoice number ⇒ uploading the same file twice is a duplicate.
    const seq = parseInt(hash.slice(0, 4), 16) % 9000;
    const extracted = scenario.make(seq, new Date());
    const id = nextId(d, 'inv');
    const inv: InvoiceDetail = {
      id,
      source: 'HUMAN_UPLOAD',
      requestingAgentName: null,
      fileName: file.name,
      mimeType: file.type,
      status: 'RECEIVED',
      receivedAt: nowIso(),
      extracted: null,
      fileSha256: hash,
      fileUrl: null,
      audit: [],
      decisionHistory: [],
      decision: null,
      approval: null,
      failureReason: null,
      vendorName: null,
      invoiceNumber: null,
      amountMinor: null,
      currency: null,
      dueDate: null,
    };
    audit(inv, 'INVOICE_RECEIVED', 'user', SEED_USER.name, { fileName: file.name, sha256: hash.slice(0, 12) });
    d.invoices.unshift(inv);
    d.meta[id] = { t0: Date.now(), scenario: scenario.key, fileName: file.name, agentName: null, agentRevoked: false, extractedFinal: extracted };
    if (typeof URL !== 'undefined' && URL.createObjectURL) fileUrls.set(id, URL.createObjectURL(file));
    persist();
    return toSummary(inv);
  },
  async listInvoices() {
    await lag();
    const d = auth();
    d.invoices.forEach((i) => advance(d, i));
    return d.invoices.map(toSummary);
  },
  async getInvoice(id) {
    await lag();
    const d = auth();
    const inv = d.invoices.find((i) => i.id === id);
    if (!inv) throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Invoice not found.' });
    advance(d, inv);
    return { ...inv, fileUrl: fileUrls.get(id) ?? null };
  },
  async processInvoice() {
    await lag(); // idempotent no-op: the mock pipeline advances on its own
  },
  async reevaluateInvoice(id, input) {
    await lag(); const d = auth(); requireOwner(d);
    const inv = d.invoices.find(i => i.id === id);
    if (!inv) throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Invoice not found.' });
    if (inv.decision?.id !== input.expectedDecisionId) throw new ApiError({ status: 409, code: 'DECISION_CHANGED', message: 'Refresh the invoice before reanalyzing.' });
    if (d.mandateActive?.id !== input.expectedPolicyVersionId) throw new ApiError({ status: 409, code: 'POLICY_CHANGED', message: 'Refresh the current policy.' });
    if (!inv.extracted || inv.decision?.decision === 'APPROVE' || inv.decisionHistory.some(h => h.decision === 'APPROVE')
      || ['APPROVED', 'REJECTED'].includes(inv.approval?.state ?? '')) {
      throw new ApiError({ status: 409, code: 'APPROVAL_NOT_ALLOWED', message: 'This invoice cannot be reopened.' });
    }
    for (const approval of d.approvals.filter(a => a.invoiceId === id && a.state === 'PENDING')) approval.state = 'INVALIDATED';
    if (inv.approval?.state === 'PENDING') inv.approval = { ...inv.approval, state: 'INVALIDATED' };
    decide(d, inv, nowIso());
    audit(inv, 'INVOICE_REEVALUATED', 'user', SEED_USER.name);
    persist(); return { ...inv, fileUrl: fileUrls.get(id) ?? null };
  },
  invoiceFileUrl: (inv) => inv.fileUrl ?? '',

  async listApprovals() {
    await lag();
    const d = auth();
    d.invoices.forEach((i) => advance(d, i));
    return [...d.approvals]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a): ApprovalRequest => {
        const inv = d.invoices.find((i) => i.id === a.invoiceId);
        return {
          id: a.id,
          invoiceId: a.invoiceId,
          state: a.state,
          reason: a.reason,
          reasons: a.reasons,
          createdAt: a.createdAt,
          canDecide: a.state === 'PENDING',
          cannotDecideReason: null,
          invoice: inv ? toSummary(inv) : undefined,
        };
      });
  },
  async decideApproval(id: string, input: ApprovalDecisionInput) {
    await lag();
    const d = auth();
    const row = d.approvals.find((a) => a.id === id);
    if (!row) throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Approval request not found.' });
    const inv = d.invoices.find((i) => i.id === row.invoiceId) as InvoiceDetail;
    if (row.state !== 'PENDING') throw new ApiError({ status: 409, code: 'APPROVAL_NOT_PENDING', message: 'This request was already resolved.' });

    const at = nowIso();
    if (input.decision === 'REJECT') {
      row.state = 'REJECTED';
      Object.assign(row, { reviewerName: SEED_USER.name, decidedAt: at, justification: input.justification });
      inv.approval = { id: row.id, state: 'REJECTED', reason: row.reason, reviewerName: SEED_USER.name, decidedAt: at, justification: input.justification };
      inv.status = 'REJECTED';
      audit(inv, 'APPROVAL_REJECTED', 'user', SEED_USER.name, { justification: input.justification }, at);
      persist();
      return;
    }

    // Re-validate EVERYTHING before confirming (§4.5).
    const re: PolicyDecision = mockEvaluate(inv.extracted as ExtractedInvoice, ctxFor(d, inv.id, d.meta[inv.id]?.agentRevoked), d.mandateActive?.version ?? 1);
    const stillOk = re.decision === 'APPROVE' || (re.decision === 'ESCALATE' && re.needsHumanApproval);
    if (!stillOk) {
      row.state = 'INVALIDATED';
      inv.approval = { id: row.id, state: 'INVALIDATED', reason: re.explanation };
      inv.decisionHistory.unshift(inv.decision as PolicyDecision);
      inv.decision = re;
      inv.status = re.decision === 'BLOCK' ? 'BLOCKED' : 'NEEDS_APPROVAL';
      audit(inv, 'APPROVAL_REVALIDATION_FAILED', 'system', null, { reasons: re.reasons }, at);
      persist();
      throw new ApiError({
        status: 409,
        code: 'REVALIDATION_FAILED',
        message: `Re-check failed, so nothing was approved. ${re.explanation}`,
        details: { reasons: re.reasons },
      });
    }

    row.state = 'APPROVED';
    Object.assign(row, { reviewerName: SEED_USER.name, decidedAt: at, justification: input.justification });
    inv.approval = { id: row.id, state: 'APPROVED', reason: row.reason, reviewerName: SEED_USER.name, decidedAt: at, justification: input.justification };
    inv.status = 'APPROVED';
    d.reservedMinor += inv.amountMinor ?? 0;
    audit(inv, 'APPROVAL_APPROVED', 'user', SEED_USER.name, { justification: input.justification, revalidated: true }, at);
    audit(inv, 'BUDGET_RESERVED', 'system', null, { amountMinor: inv.amountMinor }, at);
    persist();
  },

  async getEvaluationSummary(): Promise<EvaluationSummary> {
    await lag();
    auth();
    return runMockEvaluation();
  },

  async listAgents() {
    await lag();
    return auth().agents;
  },
  async createAgent({ name }) {
    await lag();
    const d = auth();
    const a: Agent = { id: nextId(d, 'agt'), name, scopes: ['invoice:create', 'invoice:read_own'], monthlyRequestLimitMinor: null, createdAt: nowIso(), revokedAt: null, lastUsedAt: null };
    d.agents.push(a);
    persist();
    return { ...a, apiKey: `oli_agent_mock_${Math.random().toString(36).slice(2, 12)}` };
  },
  async revokeAgent(id) {
    await lag();
    const d = auth();
    const a = d.agents.find((x) => x.id === id);
    if (!a) throw new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Agent not found.' });
    a.revokedAt = nowIso();
    persist();
    return a;
  },
  async verifyClearance(handle) {
    await lag();
    return { status: handle.startsWith('active') ? 'ACTIVE' : 'INVALID', simulated: true };
  },
};

/* ───────────────────────── mock evaluation runner ───────────────────────── */

function runMockEvaluation(): EvaluationSummary {
  // Run fixtures through the MOCK engine against a fresh seed (independent of the user's session).
  const s = seed();
  const labelled: Array<{ key: string; group: string; expected: Decision[] }> = [
    { key: 'ok', group: 'Valid invoices', expected: ['APPROVE'] },
    { key: 'over-limit', group: 'Human-review limits', expected: ['ESCALATE'] },
    { key: 'contract-mismatch', group: 'Agreement discrepancies', expected: ['ESCALATE', 'BLOCK'] },
    { key: 'duplicate', group: 'Duplicates', expected: ['BLOCK'] },
    { key: 'unknown-vendor', group: 'Unauthorized vendors', expected: ['BLOCK'] },
    { key: 'hard-limit', group: 'Limits', expected: ['BLOCK'] },
    { key: 'injection', group: 'Ambiguous / malicious', expected: ['ESCALATE', 'BLOCK'] },
    { key: 'unreadable', group: 'Ambiguous / malicious', expected: ['ESCALATE'] },
  ];
  const cases = labelled.map((l, i) => {
    const sc = SCENARIOS.find((x) => x.key === l.key) as (typeof SCENARIOS)[number];
    const x = sc.make(700 + i, new Date());
    const dec = mockEvaluate(x, ctxFor(s, null), 1);
    const correct = l.expected.includes(dec.decision);
    return {
      id: `mock_${String(i + 1).padStart(2, '0')}`,
      group: l.group,
      title: sc.label,
      expected: l.expected,
      actual: dec.decision,
      correct,
      unsafeApproval: dec.decision === 'APPROVE' && !l.expected.includes('APPROVE'),
      reasons: dec.reasons,
    };
  });
  const groups = [...new Set(cases.map((c) => c.group))].map((g) => ({
    group: g,
    total: cases.filter((c) => c.group === g).length,
    correct: cases.filter((c) => c.group === g && c.correct).length,
  }));
  const n = cases.length;
  return {
    runAt: nowIso(),
    datasetVersion: 'MOCK fixtures v0 — UI demo only, not the real evaluation',
    totalCases: n,
    unsafeApprovals: cases.filter((c) => c.unsafeApproval).length,
    decisionAccuracy: cases.filter((c) => c.correct).length / n,
    correctAutonomy: cases.filter((c) => c.correct && c.actual !== 'ESCALATE').length / n,
    explanationCoverage: cases.filter((c) => c.reasons.length > 0).length / n,
    groups,
    cases,
  };
}
