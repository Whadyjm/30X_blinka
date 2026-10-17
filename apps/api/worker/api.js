import { AgreementQuerySchema, ApprovalQuerySchema, BudgetQuerySchema, DashboardSchema,
  InvoiceQuerySchema, PaginationQuerySchema } from '@oli/contracts';
import { authenticate, login, logout, owner } from './auth.js';
import { activateMandate, budgets, mandateState, mutateDirectory, saveDraft } from './configuration.js';
import { HttpError, id, json, now, periodKey, readBytes, stmt } from './http.js';
import { agreementDto, approvalDto, decisionDto, getInvoice, invoiceRows, vendorDto } from './repository.js';
import { invoiceFile, reviewApproval, uploadInvoice } from './invoices.js';
import { processInvoice } from './processing.js';
import { chatHistory, chatMessage, listConversations } from './chat.js';
import { actionDto, cancelAction, confirmAction, getAction, prepareActionRequest, inspectInvoice } from './chat-actions.js';
import { configureTelegram, createTelegramLink, disconnectTelegram, telegramStatus } from './telegram.js';

function query(url, schema) {
  const input = Object.fromEntries(url.searchParams);
  if ([...url.searchParams.keys()].length !== Object.keys(input).length) throw new HttpError(400, 'INVALID_QUERY');
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'INVALID_QUERY');
  return parsed.data;
}
const page = (data, q) => json({ data: data.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  pagination: { page: q.page, pageSize: q.pageSize, total: data.length } });

export async function handleApi(request, env) {
  const requestId = id('req');
  try {
    const url = new URL(request.url); const path = url.pathname.slice('/api/v1'.length); const method = request.method;
    if (path === '/session' && method === 'POST') return await login(request, env);
    const session = await authenticate(request, env); const orgId = session.organization.id;
    if (path === '/me' && method === 'GET') { const { tokenHash, ...data } = session; return json({ data }); }
    if (path === '/session' && method === 'DELETE') return await logout(request, env, session);
    if (path === '/integrations/telegram' && method === 'GET') return await telegramStatus(env, session);
    if (path === '/integrations/telegram/setup' && method === 'POST') {
      owner(session); await configureTelegram(env); return new Response(null, { status: 204 });
    }
    if (path === '/integrations/telegram/link' && method === 'POST') return await createTelegramLink(env, session);
    if (path === '/integrations/telegram' && method === 'DELETE') return await disconnectTelegram(env, session);
    if (path === '/chat/messages' && method === 'POST') return await chatMessage(request, env, session);
    if (path === '/chat/conversations' && method === 'GET') return await listConversations(env, session);
    const chat = path.match(/^\/chat\/conversations\/([^/]+)$/);
    if (chat && method === 'GET') return await chatHistory(env, session, chat[1]);
    if (path === '/chat/actions' && method === 'POST') return await prepareActionRequest(request, env, session);
    const chatAction = path.match(/^\/chat\/actions\/([^/]+)(?:\/(confirm|cancel))?$/);
    if (chatAction) {
      if (method === 'GET' && !chatAction[2]) return json({ data: actionDto(await getAction(env, session, chatAction[1])) });
      if (method === 'POST' && chatAction[2] === 'confirm') return await confirmAction(request, env, session, chatAction[1]);
      if (method === 'POST' && chatAction[2] === 'cancel') return await cancelAction(request, env, session, chatAction[1]);
    }
    const intake = path.match(/^\/invoices\/([^/]+)\/intake$/);
    if (intake && method === 'GET') return json({ data: await inspectInvoice(env, session, intake[1]) });
    if (path === '/mandate' && method === 'GET') {
      const { active, draft } = await mandateState(env.DB, orgId); return json({ data: { active, draft } });
    }
    if (path === '/mandate/draft' && method === 'PUT') return await saveDraft(request, env, session);
    if (path === '/mandate/activate' && method === 'POST') return await activateMandate(request, env, session);
    const directory = path.match(/^\/(vendors|agreements)(?:\/([^/]+))?$/);
    if (directory) {
      const [, kind, resourceId] = directory;
      if ((method === 'POST' && !resourceId) || (method === 'PATCH' && resourceId)) return await mutateDirectory(request, env, session, kind, resourceId);
      if (method === 'GET' && !resourceId) {
        const q = query(url, kind === 'vendors' ? PaginationQuerySchema : AgreementQuerySchema);
        const rows = (await stmt(env.DB, `SELECT * FROM ${kind} WHERE org_id = ? ORDER BY created_at DESC, id DESC`, orgId).all()).results;
        return page(rows.map(kind === 'vendors' ? vendorDto : agreementDto).filter(r => !q.vendorId || r.vendorId === q.vendorId), q);
      }
    }
    if (path === '/budgets' && method === 'GET') {
      const q = query(url, BudgetQuerySchema);
      return json({ data: await budgets(env.DB, orgId, q.periodKey ?? periodKey(session.organization.timezone)) });
    }
    if (path === '/invoices' && method === 'POST') return await uploadInvoice(request, env, session);
    if (path === '/invoices' && method === 'GET') {
      const q = query(url, InvoiceQuerySchema);
      const rows = await invoiceRows(env.DB, orgId);
      return page(rows.filter(r => (!q.status || r.status === q.status) && (!q.action || r.latestDecision?.action === q.action)
        && (!q.vendorId || r.vendorId === q.vendorId) && (q.needsHumanApproval === undefined
          || (r.approvalRequest?.state === 'PENDING' && r.approvalRequest.canApprove) === q.needsHumanApproval)), q);
    }
    const invoice = path.match(/^\/invoices\/([^/]+)(?:\/(process|file))?$/);
    if (invoice) {
      if (method === 'GET' && !invoice[2]) return json({ data: await getInvoice(env.DB, orgId, invoice[1]) });
      if (method === 'GET' && invoice[2] === 'file') return await invoiceFile(env, orgId, invoice[1]);
      if (method === 'POST' && invoice[2] === 'process') {
        if ((await readBytes(request, 1024)).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Este endpoint no recibe datos de extracción ni decisiones.');
        const result = await processInvoice(env, orgId, invoice[1]); return json({ data: result.data }, result.status);
      }
    }
    if (path === '/approvals' && method === 'GET') {
      const q = query(url, ApprovalQuerySchema);
      const invoices = await invoiceRows(env.DB, orgId);
      const active = (await mandateState(env.DB, orgId)).active;
      const rows = (await stmt(env.DB, 'SELECT * FROM approval_requests WHERE org_id = ? AND state = ? ORDER BY created_at DESC, id DESC', orgId, q.state).all()).results;
      return page(rows.map(r => ({ approval: approvalDto(r, active?.id), invoice: invoices.find(i => i.id === r.invoice_id) })), q);
    }
    const approval = path.match(/^\/approvals\/([^/]+)\/decision$/);
    if (approval && method === 'POST') return await reviewApproval(request, env, session, approval[1]);
    if (path === '/dashboard' && method === 'GET') {
      const rows = await invoiceRows(env.DB, orgId);
      const actions = rows.map(r => r.latestDecision?.action);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: session.organization.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const recent = (await stmt(env.DB, 'SELECT * FROM decisions WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10', orgId).all()).results.map(decisionDto);
      return json({ data: DashboardSchema.parse({ counts: {
        total: rows.length, approved: actions.filter(a => a === 'APPROVE').length, blocked: actions.filter(a => a === 'BLOCK').length,
        escalated: actions.filter(a => a === 'ESCALATE').length,
        needsHumanApproval: rows.filter(r => r.approvalRequest?.state === 'PENDING' && r.approvalRequest.canApprove).length,
        processing: rows.filter(r => ['RECEIVED', 'PARSING', 'READY', 'PROCESSING'].includes(r.status)).length,
        failed: rows.filter(r => r.status === 'FAILED').length },
      budgets: await budgets(env.DB, orgId, periodKey(session.organization.timezone)),
      upcoming: rows.filter(r => r.dueDate && r.dueDate >= today && r.latestDecision?.action !== 'BLOCK' && r.status !== 'FAILED')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5), recentDecisions: recent, generatedAt: now(), simulated: true }) });
    }
    if (path === '/evaluation/summary' && method === 'GET') return json({ data: null });
    throw new HttpError(404, 'NOT_FOUND');
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error(JSON.stringify({ event: 'api_request_failed', requestId }));
    return json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'No se pudo completar la solicitud.',
      fieldErrors: known ? error.fieldErrors : {}, requestId } }, known ? error.status : 500,
    known && error.status === 429 ? { 'Retry-After': '900' } : {});
  }
}
