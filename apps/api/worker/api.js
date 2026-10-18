import { AgreementQuerySchema, ApprovalQuerySchema, BudgetQuerySchema, DashboardSchema,
  InvoiceQuerySchema, PaginationQuerySchema } from '@oli/contracts';
import { authenticate, login, logout, owner } from './auth.js';
import { activateMandate, budgets, mandateState, mutateDirectory, saveDraft } from './configuration.js';
import { HttpError, id, json, now, periodKey, readBytes, stmt } from './http.js';
import { agreementDto, approvalPage, dashboardInvoiceData, getInvoice, invoicePage, policyDto, vendorDto } from './repository.js';
import { invoiceFile, reviewApproval, uploadInvoice } from './invoices.js';
import { processInvoice } from './processing.js';
import { reevaluateInvoice } from './reevaluation.js';
import { enqueueInvoice } from './jobs.js';
import { chatHistory, chatMessage, listConversations } from './chat.js';
import { actionDto, cancelAction, confirmAction, getAction, prepareActionRequest, inspectInvoice } from './chat-actions.js';
import { configureTelegram, createTelegramLink, disconnectTelegram, telegramStatus } from './telegram.js';
import { disableEmail, emailStatus, enableEmail, inbox, readInboxMessage } from './email.js';
import { createSkillConnection, handleAgentRequest, revokeSkillConnection, skillConnections, updateSkillConnection } from './skill.js';
import { invoiceTrashEvents, setInvoiceTrash } from './invoice-trash.js';
import { evaluationReport, evaluationSummary } from './evaluation.js';

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
    if (path.startsWith('/agent/')) return await handleAgentRequest(request, env, path);
    const session = await authenticate(request, env); const orgId = session.organization.id;
    if (path === '/me' && method === 'GET') { const { tokenHash, ...data } = session; return json({ data }); }
    if (path === '/session' && method === 'DELETE') return await logout(request, env, session);
    if (path === '/integrations/skill' && method === 'GET') return await skillConnections(env, session);
    if (path === '/integrations/skill/connections' && method === 'POST') return await createSkillConnection(request, env, session);
    const skillConnection = path.match(/^\/integrations\/skill\/connections\/([^/]+)$/);
    if (skillConnection && method === 'DELETE') return await revokeSkillConnection(env, session, skillConnection[1]);
    if (skillConnection && method === 'PATCH') return await updateSkillConnection(request, env, session, skillConnection[1]);
    if (path === '/integrations/email' && method === 'GET') return await emailStatus(env, session);
    if (path === '/integrations/email' && method === 'POST') return await enableEmail(env, session);
    if (path === '/integrations/email' && method === 'DELETE') return await disableEmail(env, session);
    if (path === '/invoice-trash' && method === 'GET') return page(await invoiceTrashEvents(env.DB, orgId), query(url, PaginationQuerySchema));
    const trashInvoice = path.match(/^\/invoices\/([^/]+)\/trash$/);
    if (trashInvoice && method === 'POST') return await setInvoiceTrash(request, env, session, trashInvoice[1]);
    if (path === '/inbox' && method === 'GET') return await inbox(env, session);
    const inboxItem = path.match(/^\/inbox\/([^/]+)\/read$/);
    if (inboxItem && method === 'POST') return await readInboxMessage(env, session, inboxItem[1]);
    if (path === '/integrations/telegram' && method === 'GET') return await telegramStatus(env, session);
    if (path === '/integrations/telegram/setup' && method === 'POST') {
      owner(session); await configureTelegram(env); return new Response(null, { status: 204 });
    }
    if (path === '/integrations/telegram/link' && method === 'POST') return await createTelegramLink(env, session);
    if (path === '/integrations/telegram' && method === 'DELETE') return await disconnectTelegram(env, session);
    if (path === '/chat/messages' && method === 'POST') return await chatMessage(request, env, session);
    if (path === '/chat/conversations' && method === 'GET') return await listConversations(env, session, request);
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
    if (path === '/mandate/versions' && method === 'GET') {
      const q = query(url, PaginationQuerySchema);
      const rows = (await stmt(env.DB, 'SELECT * FROM policy_versions WHERE org_id = ? ORDER BY version DESC', orgId).all()).results;
      return page(rows.map(policyDto), q);
    }
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
      return json(await invoicePage(env.DB, orgId, q));
    }
    const invoice = path.match(/^\/invoices\/([^/]+)(?:\/(process|file|reevaluate))?$/);
    if (invoice) {
      if (method === 'POST' && invoice[2] === 'reevaluate') return await reevaluateInvoice(request, env, session, invoice[1]);
      if (method === 'GET' && !invoice[2]) return json({ data: await getInvoice(env.DB, orgId, invoice[1]) });
      if (method === 'GET' && invoice[2] === 'file') return await invoiceFile(env, orgId, invoice[1]);
      if (method === 'POST' && invoice[2] === 'process') {
        if ((await readBytes(request, 1024)).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Este endpoint no recibe datos de extracción ni decisiones.');
        const result = await (env.INVOICE_QUEUE ? enqueueInvoice : processInvoice)(env, orgId, invoice[1]); return json({ data: result.data }, result.status);
      }
    }
    if (path === '/approvals' && method === 'GET') {
      const q = query(url, ApprovalQuerySchema);
      return json(await approvalPage(env.DB, orgId, q));
    }
    const approval = path.match(/^\/approvals\/([^/]+)\/decision$/);
    if (approval && method === 'POST') return await reviewApproval(request, env, session, approval[1]);
    if (path === '/dashboard' && method === 'GET') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: session.organization.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const invoiceData = await dashboardInvoiceData(env.DB, orgId, today);
      return json({ data: DashboardSchema.parse({ ...invoiceData,
        budgets: await budgets(env.DB, orgId, periodKey(session.organization.timezone)), generatedAt: now(), simulated: true }) });
    }
    if (path === '/evaluation/summary' && method === 'GET') return json({ data: evaluationSummary() });
    if (path === '/evaluation/report' && method === 'GET') return json({ data: evaluationReport() });
    throw new HttpError(404, 'NOT_FOUND');
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error(JSON.stringify({ event: 'api_request_failed', requestId }));
    return json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'No se pudo completar la solicitud.',
      fieldErrors: known ? error.fieldErrors : {}, requestId } }, known ? error.status : 500,
    known && error.status === 429 ? { 'Retry-After': String(error.retryAfter ?? 900) } : {});
  }
}
