import { readFile } from "node:fs/promises";
import { isError, type EvidenceReference } from "../lib/contracts.ts";
import { makeSnapshot, resolveEvidence, sha256 } from "../lib/evidence.ts";

export const FROZEN_SHA256 = "238d2505377ad5ba94165b72ce9e5e375699288cf7369389804188d8cfb90bba";
export type EvalCase = { id: string; brief: string; scope: string; expected_status: string; issue_units: { id: string; evidence: EvidenceReference[] }[]; comparison_anchors?: EvidenceReference[] };

// Loads a synthetic corpus and proves every authored evidence quote matches its source line range.
// The frozen corpus must also match its pinned hash; the held-out set is checked but not pinned here.
export async function loadSuite(name: "frozen" | "holdout") {
 const text = await readFile(new URL(name === "holdout" ? "./holdout-cases.json" : "./cases.json", import.meta.url), "utf8");
 const sha = await sha256(text);
 const suite = JSON.parse(text) as { schema_version: number; synthetic: boolean; cases: EvalCase[] };
 if (name === "frozen" && (sha !== FROZEN_SHA256 || suite.cases.length !== 15 || suite.cases.some((c, i) => c.id !== `E${String(i + 1).padStart(2, "0")}`))) throw new Error("The frozen 15-case suite changed or is invalid.");
 if (suite.schema_version !== 1 || !suite.synthetic || !suite.cases.length) throw new Error("Suite must be schema 1, synthetic and non-empty.");
 for (const c of suite.cases) {
  const sources = await makeSnapshot({ brief: c.brief, scope: c.scope });
  for (const e of [...c.issue_units.flatMap(u => u.evidence), ...(c.comparison_anchors ?? [])]) if (isError(resolveEvidence(e, sources[e.source_id]))) throw new Error(`Invalid authored evidence in ${c.id}`);
 }
 return { cases: suite.cases, sha256: sha };
}

export function evaluationSelection(args: string[], frozenIds: string[]) {
 if (args.some(arg => arg !== "--enable-live" && !arg.startsWith("--cases=") && !arg.startsWith("--repetitions="))) throw new Error("Invalid evaluation selection: unknown option.");
 const casesArgs = args.filter(arg => arg.startsWith("--cases="));
 const repeatsArgs = args.filter(arg => arg.startsWith("--repetitions="));
 if (casesArgs.length > 1 || repeatsArgs.length > 1) throw new Error("Invalid evaluation selection: repeated option.");
 const ids = casesArgs.length ? casesArgs[0].slice("--cases=".length).split(",") : frozenIds;
 const repeatsText = repeatsArgs.length ? repeatsArgs[0].slice("--repetitions=".length) : "3";
 if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !frozenIds.includes(id)) || !/^[1-3]$/.test(repeatsText)) throw new Error("Invalid evaluation selection: use unique frozen case IDs and 1–3 repetitions.");
 const repetitions = Number(repeatsText);
 const planned_attempts = ids.length * repetitions;
 if (planned_attempts > 45) throw new Error("Invalid evaluation selection: at most 45 attempts.");
 return { ids, repetitions, planned_attempts, full_suite: ids.length === frozenIds.length && repetitions === 3 };
}
export function evaluationBudgetStop(fullSuite: boolean, planned: number, remaining: number): string | null {
 if (!Number.isInteger(remaining) || remaining < 0) return "unknown_free_quota";
 if (remaining === 0) return "exhausted_free_quota";
 if (fullSuite && remaining < planned) return "insufficient_free_quota_for_full_suite";
 return null;
}
