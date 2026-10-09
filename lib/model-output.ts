import { z } from "zod";
import { candidateSchema, error, findingSchema, isError, type AnalysisError, type EvidenceReference, type ModelCandidate, type SnapshotPair } from "./contracts.ts";
import { resolveEvidence } from "./evidence.ts";

// Provider transport v2 selects lines. Quotes remain part of the internal v1
// contract, but are extracted from the immutable source, never repaired from
// model-authored text. This proves character identity, not semantic relevance.
const lineReferenceSchema = z.strictObject({
 source_id: z.enum(["brief", "scope"]),
 start_line: z.number().int().positive(),
 end_line: z.number().int().positive(),
}).refine(r => r.end_line >= r.start_line);
const lineEvidence = z.array(lineReferenceSchema).min(1).max(4);
const lineFindingSchema = z.discriminatedUnion("kind", [
 findingSchema.options[0].extend({ evidence: lineEvidence }),
 findingSchema.options[1].extend({ evidence: lineEvidence }),
 findingSchema.options[2].extend({ evidence: lineEvidence }),
]);
export const modelOutputSchema = candidateSchema.extend({
 schema_version: z.literal(2),
 findings: z.array(lineFindingSchema).max(12),
 comparison_evidence: z.array(lineReferenceSchema).max(4),
});
type LineReference = z.infer<typeof lineReferenceSchema>;
function extract(reference: LineReference, sources: SnapshotPair): EvidenceReference | AnalysisError {
 const source = sources[reference.source_id];
 const first = source.lines[reference.start_line - 1];
 const last = source.lines[reference.end_line - 1];
 if (!first || !last) return error("invalid_evidence");
 const quote = source.text.slice(first.start, last.end);
 // Keep the existing evidence length, nonblank, range, hash and exact-character
 // boundary. Never trim, decode entities, normalize Unicode or clip a condition.
 const result = resolveEvidence({ ...reference, quote }, source);
 return isError(result) ? result : { ...reference, quote };
}
export function decodeModelCandidate(value: unknown, sources: SnapshotPair): ModelCandidate | AnalysisError {
 const parsed = modelOutputSchema.safeParse(value);
 if (!parsed.success) return error("invalid_response");
 const comparisons: EvidenceReference[] = [];
 for (const reference of parsed.data.comparison_evidence) {
  const resolved = extract(reference, sources); if (isError(resolved)) return resolved;
  comparisons.push(resolved);
 }
 const findings: ModelCandidate["findings"] = [];
 for (const finding of parsed.data.findings) {
  const evidence: EvidenceReference[] = [];
  for (const reference of finding.evidence) {
   const resolved = extract(reference, sources); if (isError(resolved)) return resolved;
   evidence.push(resolved);
  }
  findings.push({ ...finding, evidence });
 }
 return { ...parsed.data, schema_version: 1, comparison_evidence: comparisons, findings };
}
