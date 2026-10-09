import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isError, type EvidenceReference } from "../lib/contracts";
import { makeSnapshot, resolveEvidence, validateCandidate } from "../lib/evidence";
describe("authored synthetic evaluation, not model accuracy", () => {
  it("freezes exactly E01–E15 with matching expected evidence", async () => {
    const data = JSON.parse(await readFile("eval/cases.json", "utf8")); expect(data.synthetic).toBe(true); expect(data.cases.map((c: {id: string}) => c.id)).toEqual(Array.from({ length: 15 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`));
    for (const c of data.cases) { const sources = await makeSnapshot({ brief: c.brief, scope: c.scope }); for (const e of [...c.issue_units.flatMap((u: { evidence: EvidenceReference[] }) => u.evidence), ...(c.comparison_anchors ?? [])] as EvidenceReference[]) { const span = resolveEvidence(e, sources[e.source_id]); expect(isError(span), c.id).toBe(false); if (!isError(span)) expect(sources[e.source_id].text.slice(span.start_offset, span.end_offset)).toBe(e.quote); } }
  });
  it("paired E02/E14 false conclusions can match quotes and still fail semantic judgment", async () => {
    const data = JSON.parse(await readFile("eval/cases.json", "utf8"));
    const c2 = data.cases[1]; const sources2 = await makeSnapshot({ brief: c2.brief, scope: c2.scope });
    const negation = { schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "missing_from_scope", title: "False booking gap", rationale: "Intentionally unsupported semantic fixture.", question: "Add booking?", scope_assessment: { assessment: "not_found", basis: "Intentionally false." }, evidence: [{ source_id: "brief", start_line: 2, end_line: 2, quote: "Booking is not required." }] }] };
    expect(isError(validateCandidate(negation, sources2))).toBe(false); // Expected semantic verdict: FAIL (negation).
    const c14 = data.cases[13]; const sources14 = await makeSnapshot({ brief: c14.brief, scope: c14.scope });
    const clipped = { schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ kind: "conflict", title: "False date conflict", rationale: "Intentionally ignores matching condition and fallback.", question: "Choose 20 or 27?", evidence: [{ source_id: "brief", start_line: 2, end_line: 2, quote: "Launch on 20 October 2026" }, { source_id: "scope", start_line: 2, end_line: 2, quote: "27 October 2026 is the fallback." }] }] };
    expect(isError(validateCandidate(clipped, sources14))).toBe(false); // Expected semantic verdict: FAIL (clipped conditions).
  });
});
import { spawnSync } from "node:child_process";
it("runs the standalone frozen offline evaluator without loading credentials or calling a model", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "eval/run.ts"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "" }, timeout: 10000 });
  expect(result.status).toBe(0); expect(result.stderr).toBe(""); expect(result.stdout).toContain('"live_calls": 0'); expect(result.stdout).toContain('"cases": 15');
});
