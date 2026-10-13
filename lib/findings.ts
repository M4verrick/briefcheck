import type { Finding, FindingKind } from "./contracts.ts";

export const KIND_ORDER: FindingKind[] = ["missing_from_scope", "conflict", "clarification"];
/** Shared presentation order; never rearrange the canonical analysis. */
export function orderedFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
