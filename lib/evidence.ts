import { candidateSchema, error, inputSchema, InputError, isError, referenceSchema, type AnalysisError, type CanonicalSource, type EvidenceReference, type EvidenceSpan, type ResolvedCandidate, type ResolvedFinding, type SnapshotPair, type SourceId } from "./contracts.ts";

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function canonicalSource(id: SourceId, raw: string): Promise<CanonicalSource> {
  const text = raw.replace(/\r\n?/g, "\n");
  let start = 0;
  const lines = text.split("\n").map((line, index) => { const end = start + line.length; const result = { number: index + 1, start, end }; start = end + 1; return result; });
  return { id, text, lines, sha256: await sha256(text) };
}
export async function makeSnapshot(input: unknown): Promise<SnapshotPair> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new InputError();
  const { brief: rawBrief, scope: rawScope, project_title = "" } = parsed.data;
  const [brief, scope] = await Promise.all([canonicalSource("brief", rawBrief), canonicalSource("scope", rawScope)]);
  const identity = await sha256(JSON.stringify([project_title, brief.sha256, scope.sha256]));
  return { project_title, brief, scope, identity };
}
export function resolveEvidence(reference: EvidenceReference, source: CanonicalSource): EvidenceSpan | AnalysisError {
  const parsed = referenceSchema.safeParse(reference);
  if (!parsed.success || reference.source_id !== source.id) return error("invalid_evidence");
  const first = source.lines[reference.start_line - 1]; const last = source.lines[reference.end_line - 1];
  if (!first || !last) return error("invalid_evidence");
  const range = source.text.slice(first.start, last.end);
  const match = range.indexOf(reference.quote);
  if (match < 0 || range.indexOf(reference.quote, match + 1) >= 0) return error("invalid_evidence");
  const start_offset = first.start + match; const end_offset = start_offset + reference.quote.length;
  if (source.text.slice(start_offset, end_offset) !== reference.quote) return error("invalid_evidence");
  const name = source.id === "brief" ? "Client brief" : "Delivery plan";
  const label = reference.end_line === reference.start_line ? `${name}, line ${reference.start_line}` : `${name}, lines ${reference.start_line}–${reference.end_line}`;
  return { ...parsed.data, start_offset, end_offset, source_hash: source.sha256, label };
}
export function validateCandidate(value: unknown, sources: SnapshotPair): ResolvedCandidate | AnalysisError {
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) return error("invalid_response");
  const candidate = parsed.data;
  if (candidate.status === "limited" && !candidate.findings.length) return error("invalid_response");
  if (candidate.status === "not_comparable") {
    if (candidate.findings.length || !candidate.comparison_evidence.some((e) => e.source_id === "brief") || !candidate.comparison_evidence.some((e) => e.source_id === "scope")) return error("invalid_response");
  } else if (candidate.comparison_evidence.length) return error("invalid_response");
  const comparison_evidence: EvidenceSpan[] = [];
  for (const ref of candidate.comparison_evidence) { const span = resolveEvidence(ref, sources[ref.source_id]); if (isError(span)) return span; comparison_evidence.push(span); }
  const findings: ResolvedFinding[] = []; const seen = new Set<string>();
  for (const finding of candidate.findings) {
    if (finding.kind === "missing_from_scope" && (!finding.evidence.some((e) => e.source_id === "brief") || (finding.scope_assessment.assessment === "partially_addressed" && !finding.evidence.some((e) => e.source_id === "scope")))) return error("invalid_response");
    const evidence: EvidenceSpan[] = [];
    for (const ref of finding.evidence) { const span = resolveEvidence(ref, sources[ref.source_id]); if (isError(span)) return span; evidence.push(span); }
    if (finding.kind === "conflict" && new Set(evidence.map((e) => `${e.source_id}:${e.start_offset}:${e.end_offset}`)).size < 2) return error("invalid_response");
    const key = JSON.stringify(finding); if (seen.has(key)) continue; seen.add(key);
    findings.push({ ...finding, evidence });
  }
  return { schema_version: 1, status: candidate.status, comparison_evidence, findings };
}
