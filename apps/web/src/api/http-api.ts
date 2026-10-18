import { z } from 'zod';
import {
  InvoiceTrashEventSchema, SetInvoiceTrashSchema, ActivateMandateSchema, AgreementSchema, ApiErrorSchema, ApprovalRequestSchema, BudgetPeriodSchema,
  CreateAgreementSchema, CreateVendorSchema, EvaluationSummarySchema, InvoiceDetailSchema, InvoiceSchema, VendorSchema,
  MandateDraftSchema, PaginationSchema, PolicyVersionSchema, ReviewApprovalSchema, ReevaluateInvoiceSchema,
  SaveMandateDraftSchema, SessionSchema, TelegramIntegrationSchema, TelegramLinkSchema,
  EmailIntegrationSchema, InboxSchema, ChatMessageInputSchema, ChatReplySchema, ChatHistorySchema,
  ChatConversationsSchema, ChatActionSchema, ChatActionResultSchema, ConfirmChatActionSchema, ChatCardSchema,
  SkillIntegrationSchema, CreatedSkillConnectionSchema, SkillConnectionSchema, CreateSkillConnectionSchema, UpdateSkillConnectionSchema,
} from '@oli/contracts';
import { HealthSchema } from '@/contracts';
import { ApiError, ContractError } from './errors';
import { t } from '@/i18n';
import { detailView, draftView, invoiceView, policyView, requestView, sessionView } from './view-model';
import type { OliApi } from './types';

type HttpApiOptions = { base: string; fetchImpl?: typeof fetch; headers?: Record<string, string>; onUnauthorized?: () => void };
const envelope = <S extends z.ZodType>(schema: S) => z.strictObject({ data: schema });
const mandateSchema = z.strictObject({ active: PolicyVersionSchema.nullable(), draft: MandateDraftSchema.nullable() });

export function createHttpApi(opts: HttpApiOptions): OliApi {
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let csrf: string | null = null;
  // Retain a command's key after an ambiguous transport/5xx failure, until a definite response.
  const pendingKeys = new Map<string, string>();
  function parse<S extends z.ZodType>(endpoint: string, schema: S, data: unknown): z.output<S> {
    const result = schema.safeParse(data);
    if (!result.success) throw new ContractError(endpoint, result.error.issues);
    return result.data;
  }
  async function raw(method: string, path: string, init: { data?: unknown; form?: FormData; key?: string; timeoutMs?: number; sessionless?: boolean; allow401?: boolean } = {}): Promise<unknown> {
    if (!['GET', 'HEAD'].includes(method) && !init.sessionless && !csrf) {
      if (!await api.me()) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: t('Please sign in again.') });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 30000);
    try {
      const response = await doFetch(`${opts.base}${path}`, { method, credentials: 'include', signal: controller.signal,
        headers: { Accept: 'application/json', ...opts.headers,
          ...(init.data !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(!['GET', 'HEAD'].includes(method) && csrf && !init.sessionless ? { 'X-CSRF-Token': csrf } : {}),
          ...(init.key ? { 'Idempotency-Key': init.key } : {}) },
        body: init.form ?? (init.data !== undefined ? JSON.stringify(init.data) : undefined) });
      const text = await response.text();
      let value: unknown;
      try { value = text ? JSON.parse(text) : undefined; } catch { value = undefined; }
      if (!response.ok) {
        if (response.status === 401) { csrf = null; pendingKeys.clear(); if (!init.allow401) opts.onUnauthorized?.(); }
        const error = ApiErrorSchema.safeParse(value);
        throw new ApiError({ status: response.status, code: error.success ? error.data.error.code : `HTTP_${response.status}`,
          message: error.success ? error.data.error.message : defaultMessage(response.status),
          details: error.success ? error.data.error.fieldErrors : undefined,
          requestId: error.success ? error.data.error.requestId : undefined });
      }
      return value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError({ status: 0, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
        message: controller.signal.aborted ? t('The request took too long. Please try again.') : t('Network error') });
    } finally { clearTimeout(timer); }
  }
  const get = async <S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> => {
    const payload = parse(path, z.strictObject({ data: z.unknown() }), await raw('GET', path));
    return parse(path, schema, payload.data);
  };
  async function command(path: string, data: unknown) {
    const identity = `${path}:${JSON.stringify(data)}`;
    const key = pendingKeys.get(identity) ?? crypto.randomUUID(); pendingKeys.set(identity, key);
    try { const value = await raw('POST', path, { data, key }); pendingKeys.delete(identity); return value; }
    catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) pendingKeys.delete(identity);
      throw error;
    }
  }
  async function list<S extends z.ZodType>(path: string, schema: S, limit = Infinity): Promise<z.output<S>[]> {
    const result: z.output<S>[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const payload = parse(path, z.strictObject({ data: z.array(schema), pagination: PaginationSchema }),
        await raw('GET', `${path}${separator}page=${page}&pageSize=100`));
      result.push(...payload.data);
      if (page * payload.pagination.pageSize >= payload.pagination.total || result.length >= limit || !payload.data.length) return result.slice(0, limit);
    }
  }
  const unavailable = () => Promise.reject(new ApiError({ status: 404, code: 'NOT_AVAILABLE', message: t('This feature is not available yet.') }));
  const api: OliApi = {
    async health() {
      const response = await doFetch(`${opts.base.replace(/\/v1$/, '')}/health`);
      if (!response.ok) throw new ApiError({ status: response.status, code: 'SERVICE_UNAVAILABLE', message: defaultMessage(response.status) });
      return parse('/health', HealthSchema, await response.json());
    },
    async me() {
      try { const session = await get('/me', SessionSchema); csrf = session.csrfToken; return sessionView(session); }
      catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
    },
    async login(input) {
      const session = parse('/session', envelope(SessionSchema), await raw('POST', '/session', { data: input, sessionless: true })).data;
      csrf = session.csrfToken; pendingKeys.clear(); return sessionView(session);
    },
    loginDemo: unavailable,
    async logout() { await raw('DELETE', '/session'); csrf = null; pendingKeys.clear(); },
    createOrg: unavailable,
    async sendChatMessage(input, operationKey) {
      const data = ChatMessageInputSchema.parse(input);
      z.uuid().parse(operationKey);
      return parse('/chat/messages', envelope(ChatReplySchema), await raw('POST', '/chat/messages', { data, key: operationKey, timeoutMs: 60000 })).data;
    },
    listChatConversations: (channel = 'WEB') => get(`/chat/conversations?channel=${channel}`, ChatConversationsSchema),
    getChatHistory: id => get(`/chat/conversations/${encodeURIComponent(id)}`, ChatHistorySchema),
    async getInvoiceIntake(id) {
      const path = `/invoices/${encodeURIComponent(id)}/intake`;
      const card = await get(path, ChatCardSchema);
      if (card.type !== 'INVOICE') throw new ContractError(path, [{ path: ['type'], message: 'Expected INVOICE card' }]);
      return card;
    },
    getChatAction: id => get(`/chat/actions/${encodeURIComponent(id)}`, ChatActionSchema),
    async confirmChatAction(id) {
      const path = `/chat/actions/${encodeURIComponent(id)}/confirm`;
      return parse(path, envelope(ChatActionResultSchema), await command(path, ConfirmChatActionSchema.parse({ confirmed: true }))).data;
    },
    async cancelChatAction(id) {
      const path = `/chat/actions/${encodeURIComponent(id)}/cancel`;
      return parse(path, envelope(ChatActionSchema), await command(path, undefined)).data;
    },
    getTelegramIntegration: () => get('/integrations/telegram', TelegramIntegrationSchema),
    getSkillIntegration: () => get('/integrations/skill', SkillIntegrationSchema),
    async createSkillConnection(name) {
      const path = '/integrations/skill/connections';
      return parse(path, envelope(CreatedSkillConnectionSchema), await raw('POST', path, { data: CreateSkillConnectionSchema.parse({ name }) })).data;
    },
    async updateSkillConnection(id, expiresAt) {
      const path = `/integrations/skill/connections/${encodeURIComponent(id)}`;
      return parse(path, envelope(SkillConnectionSchema), await raw('PATCH', path, { data: UpdateSkillConnectionSchema.parse({ expiresAt }) })).data;
    },
    async revokeSkillConnection(id) { await raw('DELETE', `/integrations/skill/connections/${encodeURIComponent(id)}`); },
    async createTelegramLink() {
      return parse('/integrations/telegram/link', envelope(TelegramLinkSchema), await raw('POST', '/integrations/telegram/link')).data;
    },
    async disconnectTelegram() { await raw('DELETE', '/integrations/telegram'); },
    getEmailIntegration: () => get('/integrations/email', EmailIntegrationSchema),
    async enableEmail() { return parse('/integrations/email', envelope(EmailIntegrationSchema), await raw('POST', '/integrations/email')).data; },
    async disableEmail() { await raw('DELETE', '/integrations/email'); },
    getInbox: () => get('/inbox', InboxSchema),
    listInvoiceTrash: () => list('/invoice-trash', InvoiceTrashEventSchema),
    async setInvoiceTrash(id, input) {
      const path = `/invoices/${encodeURIComponent(id)}/trash`;
      return parse(path, envelope(InvoiceTrashEventSchema), await command(path, SetInvoiceTrashSchema.parse(input))).data;
    },
    async readInboxMessage(id) { await raw('POST', `/inbox/${encodeURIComponent(id)}/read`); },
    async listMandateVersions() { return (await list('/mandate/versions', PolicyVersionSchema)).map(policyView); },
    async getMandate() {
      const state = await get('/mandate', mandateSchema);
      const budgets = await get('/budgets', z.array(BudgetPeriodSchema));
      return { active: state.active ? policyView(state.active) : null,
        draft: state.draft ? draftView(state.draft, state.active) : null,
        budget: budgets.find(b => b.currency === state.active?.rules.currency) ?? null };
    },
    async saveMandateDraft(input) {
      const data = SaveMandateDraftSchema.parse({ expectedRevision: input.expectedRevision ?? null,
        basedOnPolicyVersionId: input.basedOnPolicyVersionId ?? null,
        rules: { currency: input.currency, automaticLimitMinor: input.automaticLimitMinor, hardLimitMinor: input.hardLimitMinor,
          monthlyBudgetMinor: input.monthlyBudgetMinor, requireAllowedVendor: input.requireAllowedVendor, requireAgreement: input.requireAgreement,
          humanApprovalEnabled: input.humanApprovalEnabled, reviewAboveMinor: input.reviewAboveMinor,
          processDaysBeforeDue: input.processDaysBeforeDue, scopedDelegations: [] } });
      const draft = parse('/mandate/draft', envelope(MandateDraftSchema), await raw('PUT', '/mandate/draft', { data })).data;
      // The visible version is descriptive; activation authority is the saved revision and policy ID.
      const active = (await get('/mandate', mandateSchema)).active;
      return draftView(draft, active);
    },
    async activateMandate(input) {
      const data = ActivateMandateSchema.parse({ draftId: input.draftId, expectedRevision: input.expectedRevision,
        expectedActivePolicyVersionId: input.expectedActivePolicyVersionId, confirmed: input.confirm });
      return policyView(parse('/mandate/activate', envelope(PolicyVersionSchema), await command('/mandate/activate', data)).data);
    },
    listVendors: () => list('/vendors', VendorSchema),
    async saveVendor(input) {
      const { id, ...fields } = input; const data = CreateVendorSchema.parse({ ...fields, externalRef: fields.externalRef ?? null });
      return parse('/vendors', envelope(VendorSchema),
        await raw(id ? 'PATCH' : 'POST', id ? `/vendors/${encodeURIComponent(id)}` : '/vendors', { data })).data;
    },
    listAgreements: () => list('/agreements', AgreementSchema),
    async saveAgreement(input) {
      const { id, ...fields } = input; const data = CreateAgreementSchema.parse(fields);
      return parse('/agreements', envelope(AgreementSchema), await raw(id ? 'PATCH' : 'POST', id ? `/agreements/${encodeURIComponent(id)}` : '/agreements', { data })).data;
    },
    async uploadInvoice(file, operationKey) {
      const identity = operationKey ?? `file:${file.name}:${file.size}:${file.lastModified}`;
      const key = pendingKeys.get(identity) ?? crypto.randomUUID(); pendingKeys.set(identity, key);
      const form = new FormData(); form.append('file', file, file.name);
      try {
        const result = parse('/invoices', envelope(InvoiceSchema), await raw('POST', '/invoices', { form, key, timeoutMs: 120000 })).data;
        pendingKeys.delete(identity); return invoiceView(result);
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) pendingKeys.delete(identity);
        throw error;
      }
    },
    async listInvoices(options) { return (await list('/invoices', InvoiceSchema, options?.limit)).map(invoiceView); },
    async getInvoice(id) { return detailView(await get(`/invoices/${encodeURIComponent(id)}`, InvoiceDetailSchema)); },
    async processInvoice(id) {
      // A timeout is ambiguous: the server may still be working. Callers keep polling this same invoice.
      parse('/process', envelope(z.union([InvoiceDetailSchema, InvoiceSchema])), await raw('POST', `/invoices/${encodeURIComponent(id)}/process`, { timeoutMs: 90000 }));
    },
    async reevaluateInvoice(id, input) {
      const path = `/invoices/${encodeURIComponent(id)}/reevaluate`;
      return detailView(parse(path, envelope(InvoiceDetailSchema), await command(path, ReevaluateInvoiceSchema.parse(input))).data);
    },
    invoiceFileUrl: invoice => invoice.fileUrl ?? `${opts.base}/invoices/${encodeURIComponent(invoice.id)}/file`,
    async listApprovals() {
      const states = ['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED'];
      const pages = await Promise.all(states.map(state => list(`/approvals?state=${state}`, z.strictObject({ approval: ApprovalRequestSchema, invoice: InvoiceSchema }))));
      return pages.flat().map(row => requestView(row.approval, row.invoice)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async decideApproval(id, input) {
      const data = ReviewApprovalSchema.parse({ action: input.decision, comment: input.justification,
        expectedDecisionId: input.expectedDecisionId, expectedPolicyVersionId: input.expectedPolicyVersionId });
      parse('/approval/decision', envelope(z.strictObject({ approval: ApprovalRequestSchema, invoice: InvoiceDetailSchema })),
        await command(`/approvals/${encodeURIComponent(id)}/decision`, data));
    },
    async getEvaluationSummary() {
      const summary = await get('/evaluation/summary', EvaluationSummarySchema.nullable());
      return summary ? { ...summary, runAt: summary.evaluatedAt, groups: [], cases: [] } : null;
    },
    listAgents: unavailable, createAgent: unavailable, revokeAgent: unavailable, verifyClearance: unavailable,
  };
  return api;
}

function defaultMessage(status: number) {
  return status === 401 ? t('Please sign in again.') : status === 403 ? t('You don’t have permission to do that.')
    : status === 429 ? t('Too many requests. Please wait a moment.') : t('The server had a problem. Nothing was approved.');
}
