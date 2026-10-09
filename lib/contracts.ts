import { z } from "zod";

export const LIMITS = { source: 16_000, total: 32_000, title: 80, findings: 12, note: 600, storage: 1_048_576 } as const;
export const inputSchema = z.strictObject({
  project_title: z.string().max(LIMITS.title).refine((s) => !/\p{Surrogate}/u.test(s)).optional(),
  brief: z.string().min(1).max(LIMITS.source).refine((s) => s.trim().length > 0 && !/\p{Surrogate}/u.test(s)),
  scope: z.string().min(1).max(LIMITS.source).refine((s) => s.trim().length > 0 && !/\p{Surrogate}/u.test(s)),
});
export type ComparisonInput = z.infer<typeof inputSchema>;
export type SourceId = "brief" | "scope";
export type CanonicalSource = { id: SourceId; text: string; sha256: string; lines: { number: number; start: number; end: number }[] };
export type SnapshotPair = { project_title: string; brief: CanonicalSource; scope: CanonicalSource; identity: string };
export const referenceSchema = z.strictObject({ source_id: z.enum(["brief", "scope"]), start_line: z.number().int().positive(), end_line: z.number().int().positive(), quote: z.string().min(1).max(LIMITS.source).refine((s) => s.trim().length > 0) }).refine((r) => r.end_line >= r.start_line);
export type EvidenceReference = z.infer<typeof referenceSchema>;
export type EvidenceSpan = EvidenceReference & { start_offset: number; end_offset: number; source_hash: string; label: string };
const meaningful = (max: number) => z.string().min(1).max(max).refine(s => s.trim().length > 0);
const findingFields = { title: meaningful(100), rationale: meaningful(500), question: meaningful(250), evidence: z.array(referenceSchema).min(1).max(4) };
const gap = z.strictObject({ ...findingFields, kind: z.literal("missing_from_scope"), scope_assessment: z.strictObject({ assessment: z.enum(["not_found", "partially_addressed"]), basis: meaningful(500) }) });
const conflict = z.strictObject({ ...findingFields, kind: z.literal("conflict") });
const clarification = z.strictObject({ ...findingFields, kind: z.literal("clarification") });
export const findingSchema = z.discriminatedUnion("kind", [gap, conflict, clarification]);
export const candidateSchema = z.strictObject({ schema_version: z.literal(1), status: z.enum(["complete", "limited", "not_comparable"]), findings: z.array(findingSchema).max(LIMITS.findings), comparison_evidence: z.array(referenceSchema).max(4) });
export type ModelCandidate = z.infer<typeof candidateSchema>;
export type ModelFinding = z.infer<typeof findingSchema>;
export type FindingKind = ModelFinding["kind"];
export type ResolvedFinding = Omit<ModelFinding, "evidence"> & { evidence: EvidenceSpan[]; scope_assessment?: z.infer<typeof gap>["scope_assessment"] };
export type ResolvedCandidate = Omit<ModelCandidate, "findings" | "comparison_evidence"> & { findings: ResolvedFinding[]; comparison_evidence: EvidenceSpan[] };
export type ErrorCode = "invalid_input" | "invalid_response" | "invalid_evidence" | "unavailable" | "timeout" | "cancelled" | "rate_limit" | "capacity" | "network" | "refused" | "invalid_draft" | "storage_unavailable";
export type AnalysisError = { code: ErrorCode; message: string };
export const MESSAGES: Record<ErrorCode, string> = {
  invalid_input: "Add a client brief and a delivery plan of up to 16,000 characters each, and a title of up to 80 characters.",
  invalid_response: "The analysis did not return a complete, valid result. Your documents are preserved; try again.",
  invalid_evidence: "A quotation could not be matched exactly to your documents, so the whole result was rejected. Try again.",
  unavailable: "AI analysis is not configured on this server. Ask your administrator to add an authorized server-side API key.",
  timeout: "The comparison timed out. Your documents are preserved; retry when you are ready.",
  cancelled: "Comparison cancelled. A request already received by the AI service may still complete and be billed.",
  rate_limit: "The AI service is busy. Your documents are preserved; try again in a moment.",
  capacity: "These documents are too long to analyse together. Shorten them; nothing was truncated.",
  network: "The analysis service could not be reached. Your documents are preserved; check your connection and try again.",
  refused: "The AI service declined to complete this comparison. No findings were accepted.",
  invalid_draft: "The saved tab draft could not be validated. It was not restored.",
  storage_unavailable: "This tab draft could not be saved. Work remains in memory and may be lost on reload.",
};
export function error(code: ErrorCode): AnalysisError { return { code, message: MESSAGES[code] }; }
export function isError(value: unknown): value is AnalysisError { return typeof value === "object" && value !== null && "code" in value; }
export class InputError extends Error { readonly code = "invalid_input"; constructor() { super(MESSAGES.invalid_input); } }
export type ProviderTelemetry = { http_status: number; request_id?: string; returned_model?: string; upstream_provider?: string; finish_reason?: string; cost_usd?: number; usage?: { input_tokens: number; output_tokens: number } };
export class ModelProviderError extends Error {
  readonly code: ErrorCode;
  readonly telemetry?: ProviderTelemetry;
  constructor(code: ErrorCode, telemetry?: ProviderTelemetry) { super(MESSAGES[code]); this.name = "ModelProviderError"; this.code = code; this.telemetry = telemetry; }
}
export type ModelReply = { candidate: unknown; completion: "complete" | "truncated" | "refused"; usage?: { input_tokens: number; output_tokens: number }; telemetry?: ProviderTelemetry; wire_candidate?: unknown; validation_error?: AnalysisError };
export interface ModelClient { readonly provider: string; readonly model: string; compare(sources: SnapshotPair, signal: AbortSignal): Promise<ModelReply>; }
export type Finding = ResolvedFinding & { id: string };
export type ValidatedAnalysis = Omit<ResolvedCandidate, "findings"> & { analysis_id: string; snapshot_id: string; sources: SnapshotPair; findings: Finding[]; origin: "sample" | "model"; prompt_version: string; analyzed_at: string; duration_ms: number; usage?: ModelReply["usage"] };
export type Disposition = "open" | "decision_recorded" | "dismissed";
export type ReviewRecord = { finding_id: string; disposition: Disposition; note: string };
