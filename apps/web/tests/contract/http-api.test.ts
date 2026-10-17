import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { createHttpApi } from '../../src/api/http-api';
import { ContractError } from '../../src/api/errors';
import { getOutcome } from '../../src/lib/outcome';
import { toDraftInput } from '../../src/features/rules/MandateSummary';
// @ts-expect-error The production Worker is JavaScript; its real bindings are supplied below.
import worker from '../../../api/worker/index.js';
import type { Invoice } from '@oli/contracts';

const report = JSON.parse(readFileSync(new URL('../../../../docs/evaluations/integration-inv_5b32e8f2-06cc-4789-8fa4-131f57e8ef55.json', import.meta.url), 'utf8'));
const detail = report.invoice;
const { extraction: _extraction, decisions: _decisions, ...invoice } = detail as Invoice & { extraction: unknown; decisions: unknown };
const session = { user: { id: 'owner', name: 'Demo Owner', email: 'owner@oli-demo.invalid' },
  organization: { id: 'org_demo', name: 'Lumen Atlas', defaultCurrency: 'USD', timezone: 'America/Caracas' }, role: 'OWNER', csrfToken: 'csrf-test' };
const response = (data: unknown) => Response.json({ data });

afterEach(() => vi.restoreAllMocks());

describe('HTTP shared contract boundary', () => {
  it('shares email/inbox schemas, preserves EMAIL invoice source and authenticates read/pause commands', async () => {
    const integration = { available: true, mailbox: { address: 'oli+company@example.invalid', enabled: true, createdAt: '2026-10-17T12:00:00.000Z' } };
    const message = { id: 'mail-test', sender: 'supplier@example.invalid', subject: 'Factura', receivedAt: '2026-10-17T12:00:00.000Z',
      state: 'COMPLETED', readAt: null, summary: 'Oli revisó los documentos.', attachments: [{ id: 'att-test', name: 'invoice.pdf', invoiceId: detail.id,
        status: detail.status, decision: detail.latestDecision.action, explanation: detail.latestDecision.humanExplanation }] };
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async (url, init) => {
      const path = String(url);
      if (path.endsWith('/me')) return response(session);
      if (init?.method !== 'GET') expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test');
      if (path.endsWith('/integrations/email')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : response(integration);
      if (path.endsWith('/inbox')) return response({ messages: [message], unreadCount: 1 });
      if (path.endsWith('/inbox/mail-test/read')) return new Response(null, { status: 204 });
      return response({ ...detail, source: 'EMAIL' });
    } });
    expect((await api.getEmailIntegration()).mailbox?.address).toBe(integration.mailbox.address);
    expect((await api.enableEmail()).mailbox?.enabled).toBe(true);
    expect((await api.getInbox()).messages[0]?.id).toBe('mail-test');
    expect((await api.getInvoice(detail.id)).source).toBe('EMAIL');
    await api.readInboxMessage('mail-test'); await api.disableEmail();
  });
  it('reanalyzes with current policy/decision guards and retains its key after a lost response', async () => {
    const keys: string[] = []; let attempts = 0;
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async (url, init) => {
      if (String(url).endsWith('/me')) return response(session);
      expect(String(url)).toBe('/api/v1/invoices/test-id/reevaluate');
      const headers = new Headers(init?.headers);
      expect(headers.get('X-CSRF-Token')).toBe('csrf-test');
      expect(JSON.parse(String(init?.body))).toEqual({ expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId });
      keys.push(headers.get('Idempotency-Key')!);
      if (++attempts === 1) throw new TypeError('lost response');
      return response(detail);
    } });
    const input = { expectedDecisionId: detail.latestDecision.id, expectedPolicyVersionId: detail.latestDecision.policyVersionId };
    await expect(api.reevaluateInvoice('test-id', input)).rejects.toMatchObject({ code: 'NETWORK' });
    expect((await api.reevaluateInvoice('test-id', input)).decision?.id).toBe(detail.latestDecision.id);
    expect(keys[0]).toBeTruthy(); expect(keys[1]).toBe(keys[0]);
  });
  it('uses /session, memory-only CSRF, private file URL, canonical decisions and DELETE logout', async () => {
    const calls: Array<{ path: string; method?: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input); const headers = new Headers(init?.headers); calls.push({ path, method: init?.method, headers });
      if (path.endsWith('/session')) return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : response(session);
      if (path.endsWith('/me')) return response(session);
      if (init?.method === 'POST') {
        expect(headers.get('X-CSRF-Token')).toBe('csrf-test'); expect(headers.get('Idempotency-Key')).toMatch(/^[\da-f-]{36}$/);
        expect(headers.has('Content-Type')).toBe(false); expect(init.body).toBeInstanceOf(FormData); return response(invoice);
      }
      return response(detail);
    };
    const api = createHttpApi({ base: '/api/v1', fetchImpl });
    expect((await api.login({ email: session.user.email, password: 'test-only' })).org?.id).toBe('org_demo');
    const uploaded = await api.uploadInvoice(new File(['synthetic'], 'demo.pdf', { type: 'application/pdf' }), 'logical-upload');
    expect(uploaded.decision?.decision).toBe('APPROVE'); expect(api.invoiceFileUrl(uploaded)).toBe(invoice.file.url);
    await api.logout(); expect(calls.at(-1)?.method).toBe('DELETE'); expect(calls.at(-1)?.headers.get('X-CSRF-Token')).toBe('csrf-test');
    expect(calls.some(c => c.path.includes('/auth/'))).toBe(false);
  });

  it('paginates with page/pageSize and validates each canonical invoice', async () => {
    const urls: string[] = [];
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async url => {
      urls.push(String(url)); const p = new URL(String(url), 'https://oli.invalid').searchParams;
      const page = Number(p.get('page')); expect(p.get('pageSize')).toBe('100'); expect(p.has('limit')).toBe(false);
      return Response.json({ data: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({ ...invoice, id: `${page}-${i}` })),
        pagination: { page, pageSize: 100, total: 101 } });
    } });
    expect(await api.listInvoices()).toHaveLength(101); expect(urls).toHaveLength(2);
  });

  it('rejects old or malformed responses rather than treating them as approval', async () => {
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async () => response({ ...invoice, latestDecision: { approved: true } }) });
    await expect(api.getInvoice('x')).rejects.toBeInstanceOf(ContractError);
    expect(getOutcome({ status: 'DECIDED', decision: null, approval: { id: 'a', state: 'APPROVED' } })).toBe('PROCESSING');
    expect(getOutcome({ status: 'DECIDED', decision: { ...detail.latestDecision, decision: 'ESCALATE' }, approval: null })).toBe('NEEDS_REVIEW');
  });

  it('retains the same upload key after a lost response and never invents CSRF', async () => {
    const keys: Array<string | null> = []; let attempts = 0;
    const api = createHttpApi({ base: '/api/v1', fetchImpl: async (url, init) => {
      if (String(url).endsWith('/me')) return response(session);
      keys.push(new Headers(init?.headers).get('Idempotency-Key'));
      if (++attempts === 1) throw new TypeError('connection lost'); return response(invoice);
    } });
    const file = new File(['synthetic'], 'demo.pdf', { type: 'application/pdf' });
    await expect(api.uploadInvoice(file, 'same-action')).rejects.toMatchObject({ code: 'NETWORK' });
    await api.uploadInvoice(file, 'same-action'); expect(keys[0]).toBeTruthy(); expect(keys[0]).toBe(keys[1]);
  });

  it('returns a genuine null evaluation and prevents P1 calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(null));
    const api = createHttpApi({ base: '/api/v1', fetchImpl });
    expect(await api.getEvaluationSummary()).toBeNull();
    await expect(api.loginDemo()).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it('real Worker + D1/R2: login, stale draft, activation, upload retry, decision and human review', async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-07-30', d1Databases: { DB: 'web-integration' }, r2Buckets: ['INVOICES'] });
  try {
    const DB = await runtime.getD1Database('DB'); const root = new URL('../../../../packages/database/', import.meta.url);
    const migrations = readdirSync(new URL('migrations/', root)).filter(f => f.endsWith('.sql')).sort().map(f => new URL(`migrations/${f}`, root));
    migrations.push(new URL('seed/demo.sql', root));
    for (const file of migrations) await DB.batch(readFileSync(file, 'utf8').split('\n-- statement-breakpoint\n').filter(s => s.trim()).map(s => DB.prepare(s)));
    let current = { vendorName: 'Demo Cloud Hosting (ficticio)', invoiceNumber: 'WEB-1', amountMinor: 20000, currency: 'USD',
      issuedAt: '2026-10-17', dueDate: '2026-10-31', servicePeriod: '2026-10', description: 'Hosting mensual ficticio', extractionWarnings: [], evidence: [] };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => Response.json({ model: JSON.parse(String(init?.body)).model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...current, documentType: 'INVOICE' }) } }] }));
    const env = { DB, INVOICES: await runtime.getR2Bucket('INVOICES'), DEMO_ORG_ID: 'org_demo', DEMO_USER_ID: 'user_demo_owner',
      DEMO_PASSWORD: 'test-only', OPENROUTER_API_KEY: 'test-only', AI: { toMarkdown: async () => ({ format: 'markdown',
        data: `EMISOR / SUPPLIER\n${current.vendorName}\nNúmero / Number\n${current.invoiceNumber}\nEmisión / Issued\n${current.issuedAt}\nPeriodo de servicio\n${current.servicePeriod}\nMoneda / Currency\nUSD\nVencimiento / Due\n2026-10-31\nCONCEPTO / DESCRIPTION\n${current.description}\nTOTAL A COBRAR\nUSD ${(current.amountMinor / 100).toFixed(2)}` }) } };
    let cookie = ''; let loseUpload = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers); headers.set('Origin', 'https://oli.invalid'); if (cookie) headers.set('Cookie', cookie);
      const result = await worker.fetch(new Request(new URL(String(input), 'https://oli.invalid'), { ...init, headers }), env);
      if (result.headers.has('Set-Cookie')) cookie = result.headers.get('Set-Cookie').split(';')[0];
      if (loseUpload && String(input).endsWith('/invoices') && init?.method === 'POST') { loseUpload = false; throw new TypeError('lost committed response'); }
      return result;
    };
    const api = createHttpApi({ base: '/api/v1', fetchImpl });
    await api.login({ email: 'owner@oli-demo.invalid', password: 'test-only' });
    const original = (await api.getMandate()).active!;
    const draft = await api.saveMandateDraft(toDraftInput(original));
    const second = await api.saveMandateDraft(toDraftInput(draft));
    await expect(api.activateMandate({ draftId: draft.id, expectedRevision: draft.revision, expectedActivePolicyVersionId: draft.basedOnPolicyVersionId, confirm: true }))
      .rejects.toMatchObject({ status: 409, code: 'DRAFT_CHANGED' });
    const active = await api.activateMandate({ draftId: second.id, expectedRevision: second.revision, expectedActivePolicyVersionId: second.basedOnPolicyVersionId, confirm: true });
    expect(active.version).toBe(2);
    await DB.batch([
      DB.prepare("INSERT INTO organizations(id,name,default_currency,timezone) VALUES ('org_history_other','Other fictitious company','USD','UTC')"),
      DB.prepare("INSERT INTO memberships(org_id,user_id,role) VALUES ('org_history_other','user_demo_owner','OWNER')"),
      DB.prepare("INSERT INTO policy_versions(id,org_id,version,status,policy_json,created_by) SELECT 'pol_history_other','org_history_other',1,'ACTIVE',policy_json,'user_demo_owner' FROM policy_versions WHERE id = ?").bind(original.id),
    ]);
    const versions = await api.listMandateVersions();
    expect(versions.map(version => [version.version, version.status])).toEqual([[2, 'ACTIVE'], [1, 'SUPERSEDED']]);
    expect(versions[1]!.automaticLimitMinor).toBe(original.automaticLimitMinor);
    expect(versions.every(version => version.id !== 'pol_history_other')).toBe(true);
    const firstPage = await fetchImpl('/api/v1/mandate/versions?page=1&pageSize=1');
    const historyPage = await firstPage.json();
    expect(historyPage.pagination.total).toBe(2);
    expect(historyPage.data).toHaveLength(1);
    expect((await api.getMandate()).active?.id).toBe(active.id);

    const file = new File([readFileSync(new URL('../../../../examples/invoices/hosting.pdf', import.meta.url))], 'hosting.pdf', { type: 'application/pdf' });
    loseUpload = true; await expect(api.uploadInvoice(file, 'first')).rejects.toMatchObject({ code: 'NETWORK' });
    const uploaded = await api.uploadInvoice(file, 'first');
    expect(await DB.prepare('SELECT count(*) AS n FROM invoices').first('n')).toBe(1);
    await api.processInvoice(uploaded.id);
    expect(getOutcome(await api.getInvoice(uploaded.id))).toBe('APPROVED');
    const repeated = await api.uploadInvoice(file, 'new-action'); await api.processInvoice(repeated.id);
    expect(getOutcome(await api.getInvoice(repeated.id))).toBe('BLOCKED');
    current = { ...current, vendorName: 'Acme Accounting (ficticio)', invoiceNumber: 'WEB-2', amountMinor: 45000, description: 'Contabilidad mensual ficticia' };
    const human = await api.uploadInvoice(new File(['%PDF-1.4\nsecond synthetic document'], 'accounting.pdf', { type: 'application/pdf' }), 'human');
    await api.processInvoice(human.id);
    const approval = (await api.listApprovals()).find(a => a.invoiceId === human.id)!;
    expect(approval.canDecide).toBe(true);
    await api.decideApproval(approval.id, { decision: 'APPROVE', justification: 'Autorización simulada en prueba de integración.',
      expectedDecisionId: approval.decisionId, expectedPolicyVersionId: approval.policyVersionId });
    const resolved = await api.getInvoice(human.id);
    expect(resolved.decision?.reasons).toContain('HUMAN_APPROVED'); expect(resolved.decisionHistory).toHaveLength(1);
    expect((await api.getMandate()).budget?.reservedMinor).toBe(65000);
    expect(await DB.prepare('SELECT count(*) AS n FROM budget_reservations').first('n')).toBe(2);
    await api.logout(); expect(await api.me()).toBeNull();
    await expect(api.listMandateVersions()).rejects.toMatchObject({ status: 401 });
  } finally { await runtime.dispose(); }
});
