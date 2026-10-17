import { ExtractionError, extractInvoiceWithOpenRouter } from "@oli/extraction";

const MAX_BYTES = 5 * 1024 * 1024;
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

async function authorized(request, expected) {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || header.length > 512) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(expected),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(header.slice(7)));
}

async function readImage(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Private synthetic-data diagnostic only; never writes invoices, decisions or reservations.
export async function handleExtractionProbe(request, env, extract = extractInvoiceWithOpenRouter) {
  if (!env.EXTRACTION_PROBE_TOKEN) return new Response("Not found", { status: 404 });
  if (!await authorized(request, env.EXTRACTION_PROBE_TOKEN)) return json({ error: { code: "UNAUTHORIZED" } }, 401);
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
  const mimeType = request.headers.get("Content-Type")?.split(";")[0].trim();
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") return json({ error: { code: "UNSUPPORTED_IMAGE_TYPE" } }, 415);
  try {
    const bytes = await readImage(request);
    if (bytes === null) return json({ error: { code: "IMAGE_TOO_LARGE" } }, 413);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const documentSha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    const result = await extract({ apiKey: env.OPENROUTER_API_KEY, documentSha256,
      images: [{ mimeType, bytes }], signal: request.signal });
    return json({ data: { ...result, verification: "NOT_CHECKED" } });
  } catch (error) {
    if (error instanceof ExtractionError) {
      const status = ["INVALID_IMAGE", "INVALID_IMAGE_SIZE_OR_COUNT"].includes(error.code) ? 400 : 502;
      return json({ error: { code: error.code, attempts: error.attempts, diagnostic: error.diagnostic } }, status);
    }
    console.error(JSON.stringify({ event: "extraction_probe_failed" }));
    return json({ error: { code: "EXTRACTION_FAILED" } }, 500);
  }
}
