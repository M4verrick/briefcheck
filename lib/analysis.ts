import { error, isError, ModelProviderError, type AnalysisError, type ModelClient, type ModelReply, type ResolvedCandidate, type SnapshotPair, type ValidatedAnalysis } from "./contracts.ts";
import { makeSnapshot, validateCandidate } from "./evidence.ts";
import { PROMPT_VERSION } from "./prompt.ts";

export function attachMetadata(candidate: ResolvedCandidate, sources: SnapshotPair, metadata: Pick<ValidatedAnalysis, "origin" | "duration_ms">, usage?: ModelReply["usage"]): ValidatedAnalysis {
  return { ...candidate, ...metadata, analysis_id: crypto.randomUUID(), snapshot_id: sources.identity, sources, findings: candidate.findings.map((f) => ({ ...f, id: crypto.randomUUID() })), prompt_version: PROMPT_VERSION, analyzed_at: new Date().toISOString(), ...(usage ? { usage } : {}) };
}
export async function analyze(input: unknown, client: ModelClient, signal: AbortSignal): Promise<ValidatedAnalysis | AnalysisError> {
  if (signal.aborted) return error("cancelled");
  let sources: SnapshotPair; try { sources = await makeSnapshot(input); } catch { return error("invalid_input"); }
  if (signal.aborted) return error("cancelled");
  const start = performance.now(); const remote = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined; let onAbort = () => {};
  try {
    const stopped = new Promise<AnalysisError>((resolve) => {
      onAbort = () => { remote.abort(); resolve(error("cancelled")); };
      signal.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => { remote.abort(); resolve(error("timeout")); }, 60_000);
      if (signal.aborted) onAbort();
    });
    const reply = await Promise.race([client.compare(sources, remote.signal), stopped]);
    if (isError(reply)) return reply;
    if (signal.aborted) return error("cancelled");
    if (reply.completion === "refused") return error("refused");
    if (reply.completion !== "complete") return error("invalid_response");
    if (reply.validation_error) return error(reply.validation_error.code);
    const resolved = validateCandidate(reply.candidate, sources); if (isError(resolved)) return resolved;
    return attachMetadata(resolved, sources, { origin: "model", duration_ms: Math.round(performance.now() - start) }, reply.usage);
  } catch (cause) {
    if (signal.aborted) return error("cancelled");
    return error(cause instanceof ModelProviderError ? cause.code : "network");
  }
  finally { if (timeout) clearTimeout(timeout); signal.removeEventListener("abort", onAbort); }
}
