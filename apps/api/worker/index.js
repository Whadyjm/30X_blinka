import { handleExtractionProbe } from "./extraction-probe.js";

export default {
  async fetch(request, env) {
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

    return new Response("Not found", { status: 404 });
  },
};
