import { makeSnapshot } from "../lib/evidence";
import { attachMetadata } from "../lib/analysis";
export async function fixtureAnalysis() {
  const sources = await makeSnapshot({ project_title: "Test", brief: "Booking required.", scope: "Email signup." });
  return attachMetadata({ schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "clarification", title: "Booking details", rationale: "Clarify test booking details.", question: "Which booking details?", evidence: [{ source_id: "brief", start_line: 1, end_line: 1, quote: "Booking required.", start_offset: 0, end_offset: 17, source_hash: sources.brief.sha256, label: "Client brief, line 1" }] }] }, sources, { origin: "sample", duration_ms: 0 });
}
