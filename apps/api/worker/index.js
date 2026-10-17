import { handleExtractionProbe } from "./extraction-probe.js";
import { handleApi } from "./api.js";
import { consumeTelegram, telegramWebhook } from './telegram.js';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/channels/telegram/webhook') return telegramWebhook(request, env);
    if (new URL(request.url).pathname.startsWith('/api/v1/')) return handleApi(request, env);
    if (new URL(request.url).pathname === "/api/internal/extraction-probe") {
      return handleExtractionProbe(request, env);
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
  async queue(batch, env) {
    return consumeTelegram(batch, env);
  },
};
