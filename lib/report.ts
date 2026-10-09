import type { ReviewRecord, ValidatedAnalysis } from "./contracts.ts";
export type ReportOptions = { include_dismissed: boolean; review_revision: number };
export type ReportDocument = { analysis: ValidatedAnalysis; reviews: ReviewRecord[]; options: ReportOptions; counts: { all: number; included: number; omitted: number; open: number; decision_recorded: number; dismissed: number }; draft: boolean; generated_at: string };
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
export function buildReport(analysis: ValidatedAnalysis, reviews: ReviewRecord[], options: ReportOptions): ReportDocument {
  if (analysis.status === "not_comparable" || reviews.length !== analysis.findings.length || new Set(reviews.map((r) => r.finding_id)).size !== reviews.length || reviews.some((r) => !analysis.findings.some((f) => f.id === r.finding_id) || r.note.length > 600 || (r.disposition !== "open" && !r.note.trim()))) throw new Error("This review is not exportable.");
  const all = reviews.length; const dismissed = reviews.filter((r) => r.disposition === "dismissed").length; const omitted = options.include_dismissed ? 0 : dismissed;
  const document: ReportDocument = { analysis: structuredClone(analysis), reviews: structuredClone(reviews), options: { ...options }, counts: { all, included: all - omitted, omitted, open: reviews.filter((r) => r.disposition === "open").length, decision_recorded: reviews.filter((r) => r.disposition === "decision_recorded").length, dismissed }, draft: reviews.some((r) => r.disposition === "open"), generated_at: new Date().toISOString() };
  return freeze(document);
}
// Backslash-escape inline syntax and neutralise line-start list, rule and setext
// markers so user or model text can never add structure to the export.
const escapeLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimStart().replace(/[\\`*_{}\[\]()#!|~<>&]/g, "\\$&").replace(/^([-+=])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2")).join("\n");
/** Single-line field: newlines collapse to spaces. */
export const safeMarkdown = (text: string) => escapeLines(text.replace(/\s*[\r\n]+\s*/g, " ").trim());
/** Exact source quote, verbatim inside a fence longer than any backtick run it contains. */
const fenced = (text: string) => { const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1))); return `${fence}text\n${text.replace(/\r\n?/g, "\n")}\n${fence}`; };
export function toMarkdown(report: ReportDocument): string {
  const a = report.analysis; const lines: string[] = ["# BriefCheck report", `\n${safeMarkdown(a.sources.project_title || "Untitled comparison")}`, `\n${report.draft ? "DRAFT — Open decisions remain." : "User review recorded. This does not certify a complete scope."}`, "Original documents are unchanged. User-recorded decisions are user-reported; client assent is unverified.", ...(a.origin === "sample" ? ["Sample data — illustrative findings written by hand. No AI analysis was run."] : []), ...(a.status === "limited" ? ["Additional issues may exist — limited analysis."] : []), `All findings: ${report.counts.all} · Included: ${report.counts.included} · Omitted dismissed: ${report.counts.omitted}`, `Open: ${report.counts.open} · Decision recorded: ${report.counts.decision_recorded} · Dismissed: ${report.counts.dismissed}`];
  const sections = [{ state: "open", heading: "Decisions still needed" }, { state: "decision_recorded", heading: "Decisions recorded" }, ...(report.options.include_dismissed ? [{ state: "dismissed", heading: "Dismissed findings" }] : [])];
  for (const section of sections) {
    lines.push(`\n## ${section.heading}\n`);
    const records = report.reviews.filter((r) => r.disposition === section.state);
    if (!records.length) lines.push("None recorded in this section. This does not certify scope readiness.");
    for (const review of records) {
      const finding = a.findings.find((f) => f.id === review.finding_id)!;
      lines.push(`\n### ${safeMarkdown(finding.title)}\n`, `Type: ${finding.kind.replaceAll("_", " ")} · State: ${review.disposition.replaceAll("_", " ")}`, `\nQuestion: ${safeMarkdown(finding.question)}`, `\nPotential business consequence (interpretation): ${safeMarkdown(finding.rationale)}`);
      if (finding.scope_assessment) lines.push(`\nFull-scope absence assessment (${finding.scope_assessment.assessment.replaceAll("_", " ")}; model interpretation): ${safeMarkdown(finding.scope_assessment.basis)}`);
      for (const e of finding.evidence) lines.push(`\n${e.label} — Quote matched\n\n${fenced(e.quote)}`);
      lines.push(`\nUser note${review.disposition === "decision_recorded" ? " / recorded outcome" : ""}: ${review.note ? `\n\n${escapeLines(review.note)}` : "None recorded."}`);
    }
  }
  return lines.join("\n") + "\n";
}
