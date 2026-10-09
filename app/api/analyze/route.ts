import { analyze } from "../../../lib/analysis";
import { error, inputSchema, isError, type AnalysisError } from "../../../lib/contracts";
import { configuredClient } from "../../../lib/provider";
export const runtime = "nodejs";
const statuses: Record<AnalysisError["code"], number> = { invalid_input: 400, capacity: 413, rate_limit: 429, unavailable: 503, timeout: 504, cancelled: 499, invalid_response: 502, invalid_evidence: 502, refused: 502, network: 502, invalid_draft: 400, storage_unavailable: 400 };
// ponytail: single-process in-flight cap; use a shared limiter if this ever runs on more than one instance.
let inFlight = 0;
function fail(e: AnalysisError) { return Response.json({ ok: false, error: e }, { status: statuses[e.code], headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  // Next dev can reconstruct request.url with localhost while the browser uses 127.0.0.1.
  // Validate the actual Host against this local-only server, then compare the browser Origin.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!["127.0.0.1:4317", "localhost:4317"].includes(host) || (origin && origin !== `http://${host}`) || !request.headers.get("content-type")?.startsWith("application/json")) return fail(error("invalid_input"));
  let raw: unknown;
  try {
    const reader = request.body?.getReader(); if (!reader) return fail(error("invalid_input"));
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256_000) { await reader.cancel(); return fail(error("capacity")); } chunks.push(part.value); }
    const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch { return fail(error("invalid_input")); }
  const input = inputSchema.safeParse(raw); if (!input.success) return fail(error("invalid_input"));
  const client = configuredClient(); if (isError(client)) return fail(client);
  if (inFlight >= 2) return fail(error("rate_limit"));
  inFlight++;
  let result; try { result = await analyze(input.data, client, request.signal); } finally { inFlight--; }
  return isError(result) ? fail(result) : Response.json({ ok: true, analysis: result }, { headers: { "Cache-Control": "no-store" } });
}
