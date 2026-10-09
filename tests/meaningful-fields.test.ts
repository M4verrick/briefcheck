import { describe, expect, it } from "vitest";
import { isError } from "../lib/contracts";
import { makeSnapshot, validateCandidate } from "../lib/evidence";
describe("nonblank model finding fields", () => {
  it.each(["title", "rationale", "question", "basis"])("rejects a whitespace-only %s rather than presenting an empty decision", async field => {
    const sources = await makeSnapshot({ brief: "Booking required.", scope: "Email signup." });
    const finding = { title: "Booking gap", rationale: "Booking is missing; its delivery consequence is uncertain.", question: "Include booking?", kind: "missing_from_scope", evidence: [{ source_id: "brief", start_line: 1, end_line: 1, quote: "Booking required." }], scope_assessment: { assessment: "not_found", basis: "Only signup is listed." } };
    if (field === "basis") finding.scope_assessment.basis = " \n "; else finding[field as "title" | "rationale" | "question"] = " \n ";
    expect(validateCandidate({ schema_version: 1, status: "complete", comparison_evidence: [], findings: [finding] }, sources)).toMatchObject({ code: "invalid_response" });
  });
  it("retains the exact source characters while accepting meaningful field text", async () => {
    const sources = await makeSnapshot({ brief: "Booking required.", scope: "Email signup." });
    const result = validateCandidate({ schema_version: 1, status: "complete", comparison_evidence: [], findings: [{ title: "Booking gap", rationale: "The booking requirement is absent; its business consequence is uncertain.", question: "Include booking?", kind: "missing_from_scope", evidence: [{ source_id: "brief", start_line: 1, end_line: 1, quote: "Booking required." }], scope_assessment: { assessment: "not_found", basis: "Only signup is listed." } }] }, sources);
    expect(isError(result)).toBe(false); if (!isError(result)) expect(result.findings[0].evidence[0].quote).toBe("Booking required.");
  });
});
