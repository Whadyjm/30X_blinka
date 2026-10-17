import { z } from 'zod';
import {
  AgentSchema,
  AgreementSchema,
  ApiErrorBodySchema,
  ApprovalRequestSchema,
  ClearanceVerificationSchema,
  CreatedAgentSchema,
  EvaluationSummarySchema,
  HealthSchema,
  InvoiceDetailSchema,
  InvoiceSummarySchema,
  MandateStateSchema,
  MeSchema,
  VendorSchema,
  listOf,
} from '@/contracts';
import { ApiError, ContractError } from './errors';
import { getLang, t } from '@/i18n';
import { camelize, flattenInvoice } from './normalize';
import type { OliApi } from './types';

export type HttpApiOptions = {
  /** e.g. "/api/v1" or "https://x.workers.dev/api/v1" */
  base: string;
  /** Inject for tests / Node. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra headers on every call (tests: Cookie). */
  headers?: Record<string, string>;
  /** Called on any 401 except GET /me. */
  onUnauthorized?: () => void;
};

const JSON_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000; // extraction through a multimodal model can be slow

export function createHttpApi(opts: HttpApiOptions): OliApi {
  const { base } = opts;
  const doFetch: typeof fetch = opts.fetchImpl ?? ((...a) => fetch(...a));

  async function raw(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    init: { json?: unknown; form?: FormData; timeoutMs?: number; allow401?: boolean } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': getLang(), ...(opts.headers ?? {}) };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.form) {
      body = init.form; // browser sets multipart boundary
    }
    // CSRF defence for cookie sessions: a custom header cannot be set by a cross-site <form>.
    if (method !== 'GET') headers['X-Requested-With'] = 'oli-web';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? JSON_TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body, credentials: 'include', signal: ctrl.signal });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      throw new ApiError({
        status: 0,
        code: aborted ? 'TIMEOUT' : 'NETWORK',
        message: aborted ? t('The request took too long. Please try again.') : t('Network error'),
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      if (res.status === 401 && !init.allow401) opts.onUnauthorized?.();
      const err = ApiErrorBodySchema.safeParse(parsed);
      if (err.success) {
        throw new ApiError({ status: res.status, ...err.data.error });
      }
      throw new ApiError({
        status: res.status,
        code: `HTTP_${res.status}`,
        message: defaultMessage(res.status),
      });
    }
    return parsed;
  }

  function parse<S extends z.ZodType>(endpoint: string, schema: S, data: unknown): z.output<S> {
    const r = schema.safeParse(data);
    if (!r.success) {
      const e = new ContractError(endpoint, r.error.issues);
      if (import.meta.env?.DEV) console.error(e.message, r.error.issues, data);
      throw e;
    }
    return r.data;
  }

  const get = <S extends z.ZodType>(path: string, schema: S) =>
    raw('GET', path).then((d) => parse(`GET ${path}`, schema, camelize(d)));

  const send = (method: 'POST' | 'PUT', path: string, json?: unknown) => raw(method, path, { json });

  const api: OliApi = {
    health: () => doFetch(base.replace(/\/v1$/, '') + '/health').then(async (r) => parse('GET /api/health', HealthSchema, await r.json())),

    async me() {
      try {
        const d = await raw('GET', '/me', { allow401: true });
        return parse('GET /me', MeSchema, camelize(d));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    async login(input) {
      await send('POST', '/auth/login', input);
      const me = await api.me();
      if (!me) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign-in did not create a session.' });
      return me;
    },
    async loginDemo() {
      await send('POST', '/auth/demo');
      const me = await api.me();
      if (!me) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Demo sign-in did not create a session.' });
      return me;
    },
    async logout() {
      await send('POST', '/auth/logout');
    },
    async createOrg(input) {
      await send('POST', '/orgs', input);
      const me = await api.me();
      if (!me) throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Session lost after creating the organization.' });
      return me;
    },

    getMandate: () => get('/mandate', MandateStateSchema),
    async saveMandateDraft(input) {
      await send('PUT', '/mandate/draft', input);
      const s = await api.getMandate();
      if (!s.draft) throw new ContractError('PUT /mandate/draft', [{ path: ['draft'], message: 'draft missing after save' }]);
      return s.draft;
    },
    async activateMandate(input) {
      await send('POST', '/mandate/activate', input);
      const s = await api.getMandate();
      if (!s.active) throw new ContractError('POST /mandate/activate', [{ path: ['active'], message: 'active policy missing after activation' }]);
      return s.active;
    },
    listVendors: () => get('/vendors', listOf(VendorSchema)),
    saveVendor: (input) => send('POST', '/vendors', input).then((d) => parse('POST /vendors', VendorSchema, camelize(d))),
    listAgreements: () => get('/agreements', listOf(AgreementSchema)),
    saveAgreement: (input) => send('POST', '/agreements', input).then((d) => parse('POST /agreements', AgreementSchema, camelize(d))),

    async uploadInvoice(file) {
      const form = new FormData();
      form.append('file', file, file.name);
      const d = await raw('POST', '/invoices', { form, timeoutMs: UPLOAD_TIMEOUT_MS });
      return parse('POST /invoices', InvoiceSummarySchema, flattenInvoice(camelize(d)));
    },
    async listInvoices(o) {
      const q = o?.limit ? `?limit=${encodeURIComponent(String(o.limit))}` : '';
      const d = await raw('GET', `/invoices${q}`);
      const flat = camelize<unknown>(d);
      const envelope = flat as { items?: unknown; data?: unknown } | null;
      const list = Array.isArray(flat) ? flat : (envelope?.items ?? envelope?.data ?? flat);
      return parse('GET /invoices', z.array(InvoiceSummarySchema), Array.isArray(list) ? list.map(flattenInvoice) : list);
    },
    async getInvoice(id) {
      const d = await raw('GET', `/invoices/${encodeURIComponent(id)}`);
      return parse(`GET /invoices/${id}`, InvoiceDetailSchema, flattenInvoice(camelize(d)));
    },
    async processInvoice(id) {
      await send('POST', `/invoices/${encodeURIComponent(id)}/process`);
    },
    invoiceFileUrl: (inv) => inv.fileUrl ?? `${base}/invoices/${encodeURIComponent(inv.id)}/file`,

    listApprovals: () => get('/approvals', listOf(ApprovalRequestSchema)),
    async decideApproval(id, input) {
      await send('POST', `/approvals/${encodeURIComponent(id)}/decision`, input);
    },

    getEvaluationSummary: () => get('/evaluation/summary', EvaluationSummarySchema),

    listAgents: () => get('/agents', listOf(AgentSchema)),
    createAgent: (input) => send('POST', '/agents', input).then((d) => parse('POST /agents', CreatedAgentSchema, camelize(d))),
    revokeAgent: (id) => send('POST', `/agents/${encodeURIComponent(id)}/revoke`).then((d) => parse('POST /agents/:id/revoke', AgentSchema, camelize(d))),

    verifyClearance: (handle) => get(`/clearances/${encodeURIComponent(handle)}/verify`, ClearanceVerificationSchema),
  };

  return api;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return t('The request was not valid.');
    case 401:
      return t('Please sign in again.');
    case 403:
      return t('You don’t have permission to do that.');
    case 404:
      return t('Not found.');
    case 409:
      return t('This conflicts with the current state. Refresh and try again.');
    case 413:
      return t('That file is too large.');
    case 429:
      return t('Too many requests. Please wait a moment.');
    default:
      return status >= 500 ? t('The server had a problem. Nothing was approved.') : t('Request failed.');
  }
}
