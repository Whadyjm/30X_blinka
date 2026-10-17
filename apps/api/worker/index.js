import { handleExtractionProbe, handleDocumentProbe } from "./extraction-probe.js";
import { handleApi } from "./api.js";
import { consumeTelegram, telegramWebhook } from './telegram.js';
import { consumeInvoiceJobs, enqueueInvoice, recoverInvoiceJobs } from './jobs.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/channels/telegram/webhook') return telegramWebhook(request, env);
    if (new URL(request.url).pathname.startsWith('/api/v1/')) return handleApi(request, env);
    if (new URL(request.url).pathname === "/api/internal/extraction-probe") {
      return handleExtractionProbe(request, env);
    }
    if (new URL(request.url).pathname === '/api/internal/document-probe') {
      return handleDocumentProbe(request, env);
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
      } catch {
        console.error(JSON.stringify({ event: "database_health_failed" }));
        return Response.json({ ok: false, service: "oli-api" }, { status: 503 });
      }
      return Response.json({ ok: true, service: "oli-api" });
    }

    if (new URL(request.url).pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
  async scheduled(_controller, env) {
    const result = await recoverInvoiceJobs(env);
    console.log(JSON.stringify({ event: 'invoice_jobs_recovered', ...result }));
  },
  async queue(batch, env) {
    if (batch.queue === 'oli-invoices') return consumeInvoiceJobs(batch, env);
    if (batch.queue === 'oli-telegram') return consumeTelegram(batch, env, enqueueInvoice);
    throw new Error('UNKNOWN_QUEUE');
  },
};
