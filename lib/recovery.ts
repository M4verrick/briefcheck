import { z } from "zod";
import { error, isError, LIMITS, referenceSchema, type AnalysisError, type ComparisonInput, type EvidenceReference, type EvidenceSpan, type ValidatedAnalysis } from "./contracts.ts";
import { makeSnapshot, validateCandidate } from "./evidence.ts";
import type { SessionState } from "./session.ts";
export const DRAFT_KEY = "briefcheck.draft.v1";
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RestoredDraft = Pick<SessionState, "input" | "analysis" | "reviews" | "drafts" | "revision">;
export type RecoveryResult = { ok: true } | { ok: false; error: AnalysisError };
const draftInput = z.strictObject({ project_title: z.string().max(80).optional(), brief: z.string().max(16000), scope: z.string().max(16000) });
const lineSchema = z.strictObject({ number: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
const sourceSchema = z.strictObject({ id: z.enum(["brief", "scope"]), text: z.string().max(16000), sha256: z.string().regex(/^[a-f0-9]{64}$/), lines: z.array(lineSchema).max(16001) });
const pairSchema = z.strictObject({ project_title: z.string().max(80), brief: sourceSchema, scope: sourceSchema, identity: z.string().regex(/^[a-f0-9]{64}$/) });
const spanSchema = referenceSchema.safeExtend({ start_offset: z.number().int().nonnegative(), end_offset: z.number().int().nonnegative(), source_hash: z.string().regex(/^[a-f0-9]{64}$/), label: z.string().max(40) });
const storedFinding = z.strictObject({ id: z.uuid(), kind: z.enum(["missing_from_scope", "conflict", "clarification"]), title: z.string().min(1).max(100), rationale: z.string().min(1).max(500), question: z.string().min(1).max(250), evidence: z.array(spanSchema).min(1).max(4), scope_assessment: z.strictObject({ assessment: z.enum(["not_found", "partially_addressed"]), basis: z.string().min(1).max(500) }).optional() });
const analysisSchema = z.strictObject({ schema_version: z.literal(1), status: z.enum(["complete", "limited", "not_comparable"]), findings: z.array(storedFinding).max(12), comparison_evidence: z.array(spanSchema).max(4), analysis_id: z.uuid(), snapshot_id: z.string().regex(/^[a-f0-9]{64}$/), sources: pairSchema, origin: z.enum(["sample", "model"]), prompt_version: z.string().min(1).max(80), analyzed_at: z.iso.datetime(), duration_ms: z.number().finite().nonnegative(), usage: z.strictObject({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).optional() });
const reviewSchema = z.strictObject({ finding_id: z.uuid(), disposition: z.enum(["open", "decision_recorded", "dismissed"]), note: z.string().max(600) });
const draftSchema = z.strictObject({ version: z.literal(1), input: draftInput, analysis: analysisSchema.nullable(), reviews: z.array(reviewSchema).max(12), drafts: z.record(z.string(), z.string().max(600)), revision: z.number().int().nonnegative() });
const ref = (e: EvidenceReference): EvidenceReference => ({ source_id: e.source_id, start_line: e.start_line, end_line: e.end_line, quote: e.quote });
function sameSpan(a: EvidenceSpan, b: EvidenceSpan) { return Object.keys(a).every((key) => a[key as keyof EvidenceSpan] === b[key as keyof EvidenceSpan]); }
export async function verifyAnalysis(value: unknown, input: ComparisonInput): Promise<ValidatedAnalysis | AnalysisError> {
  const parsed = analysisSchema.safeParse(value); if (!parsed.success) return error("invalid_draft");
  const a = parsed.data; let sources; try { sources = await makeSnapshot(input); } catch { return error("invalid_draft"); }
  if (a.snapshot_id !== sources.identity || a.sources.identity !== sources.identity || a.sources.project_title !== sources.project_title) return error("invalid_draft");
  for (const id of ["brief", "scope"] as const) { const old = a.sources[id]; const actual = sources[id]; if (old.id !== id || old.text !== actual.text || old.sha256 !== actual.sha256 || JSON.stringify(old.lines) !== JSON.stringify(actual.lines)) return error("invalid_draft"); }
  if (a.origin === "sample" && a.usage) return error("invalid_draft");
  if (new Set(a.findings.map((f) => f.id)).size !== a.findings.length) return error("invalid_draft");
  const candidate = { schema_version: 1, status: a.status, comparison_evidence: a.comparison_evidence.map(ref), findings: a.findings.map(({ id: _id, evidence, ...f }) => ({ ...f, evidence: evidence.map(ref) })) };
  const resolved = validateCandidate(candidate, sources); if (isError(resolved) || resolved.findings.length !== a.findings.length) return error("invalid_draft");
  if (!resolved.comparison_evidence.every((e, i) => sameSpan(e, a.comparison_evidence[i]))) return error("invalid_draft");
  if (!resolved.findings.every((f, i) => f.evidence.every((e, j) => sameSpan(e, a.findings[i].evidence[j])))) return error("invalid_draft");
  return { ...a, sources, findings: a.findings };
}
export function saveDraft(state: SessionState, storage: StorageLike): RecoveryResult {
  try {
    if (!state.recoveryOptIn) { storage.removeItem(DRAFT_KEY); return { ok: true }; }
    // While sources are being edited, keep the pre-edit review stored so a reload cannot lose it.
    const kept = state.backup ? { ...state, ...state.backup } : state;
    const value = JSON.stringify({ version: 1, input: kept.input, analysis: kept.analysis, reviews: kept.reviews, drafts: kept.drafts, revision: kept.revision });
    if (new TextEncoder().encode(value).byteLength > LIMITS.storage) return { ok: false, error: error("storage_unavailable") };
    storage.setItem(DRAFT_KEY, value); return { ok: true };
  } catch { return { ok: false, error: error("storage_unavailable") }; }
}
export async function restoreDraft(storage: StorageLike): Promise<RestoredDraft | AnalysisError | null> {
  let raw: string | null; try { raw = storage.getItem(DRAFT_KEY); } catch { return error("storage_unavailable"); }
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).byteLength > LIMITS.storage) return error("invalid_draft");
  let value: unknown; try { value = JSON.parse(raw); } catch { return error("invalid_draft"); }
  const parsed = draftSchema.safeParse(value); if (!parsed.success) return error("invalid_draft");
  const { input, reviews, drafts, revision } = parsed.data;
  const analysis = parsed.data.analysis ? await verifyAnalysis(parsed.data.analysis, input) : null;
  if (isError(analysis)) return analysis;
  const ids = new Set(analysis?.findings.map((f) => f.id) ?? []);
  if (reviews.length !== ids.size || new Set(reviews.map((r) => r.finding_id)).size !== ids.size || reviews.some((r) => !ids.has(r.finding_id) || (r.disposition !== "open" && !r.note.trim())) || Object.keys(drafts).length !== ids.size || Object.keys(drafts).some((id) => !ids.has(id))) return error("invalid_draft");
  return { input, analysis, reviews, drafts, revision };
}
