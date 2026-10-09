// Measures a Claude model on the frozen corpus with the same prompt, wire-v2
// decoder and validation boundary as the app. Paid API: requires explicit
// owner approval, an ANTHROPIC_API_KEY, and stops at a dollar budget.
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { analyze } from "../lib/analysis.ts";
import { isError, type ModelClient, type ModelReply } from "../lib/contracts.ts";
import { sha256 } from "../lib/evidence.ts";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "../lib/prompt.ts";
import { ANTHROPIC_MODEL, anthropicClient, type Effort } from "../lib/provider.ts";
import { evaluationSelection, loadSuite } from "./selection.ts";

// USD per million tokens for the pinned app model, Anthropic first-party list price as of 2026-10.
const [inPrice, outPrice] = [4, 20];
const MAX_TOKENS = 16_000;
const model = ANTHROPIC_MODEL;

const args = process.argv.slice(2);
const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const effort = option("effort") ?? "medium";
const budget = Number(option("budget") ?? "5");
if (args.some(a => a.startsWith("--model="))) throw new Error(`The app adapter pins ${ANTHROPIC_MODEL}; --model is not supported.`);
if (!["low", "medium", "high"].includes(effort) || !(budget > 0)) throw new Error("Use --effort=low|medium|high and a positive --budget in USD.");
const costOf = (u: { input_tokens: number; output_tokens: number }) => (u.input_tokens * inPrice + u.output_tokens * outPrice) / 1e6;
// ponytail: worst case assumes every remaining attempt fills max_tokens; fine for a few-dollar budget.
const worstCaseAttempt = (2_500 * inPrice + MAX_TOKENS * outPrice) / 1e6;

// --suite=holdout runs eval/holdout-cases.json: the held-out set, authored without the prompt and never tuned on.
const suiteName = option("suite") ?? "frozen";
if (!["frozen", "holdout"].includes(suiteName)) throw new Error("Use --suite=frozen or --suite=holdout.");
const { cases, sha256: suiteSha256 } = await loadSuite(suiteName as "frozen" | "holdout");
const suite = { cases };
const selection = evaluationSelection(args.filter(a => !/^--(effort|budget|suite)=/.test(a)), suite.cases.map(c => c.id));
const plan = { model, effort, budget_usd: budget, suite: suiteName, suite_sha256: suiteSha256, cases: suite.cases.length, planned_attempts: selection.planned_attempts, worst_case_usd: +(worstCaseAttempt * selection.planned_attempts).toFixed(2), prompt_version: PROMPT_VERSION };

if (!args.includes("--enable-live")) {
  console.log(JSON.stringify({ mode: "dry-run", live_calls: 0, ...plan, note: "Add --enable-live to spend real money on the Anthropic API." }, null, 2));
} else {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    try { loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); } catch { /* handled below */ }
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) { console.error("STOP: no ANTHROPIC_API_KEY. No requests made."); process.exit(1); }
  // No automatic retries and no refusal fallback: every attempt is one request to the named model.
  const client = anthropicClient(process.env.ANTHROPIC_API_KEY!.trim(), effort as Effort, process.env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined);
  // A 400 means the request itself is wrong; repeating it cannot succeed.
  let badRequest: string | null = null;
  await mkdir(new URL("./runs/", import.meta.url), { recursive: true });
  const file = new URL(`./runs/${model}-${suiteName}-${new Date().toISOString().replaceAll(":", "-")}.json`, import.meta.url);
  const runs: Record<string, unknown>[] = [];
  const journal = { schema_version: 2, synthetic: true, started_at: new Date().toISOString(), finished_at: null as string | null, status: "running", stop_reason: null as string | null, ...plan, provider: "anthropic", prompt_sha256: await sha256(SYSTEM_PROMPT), spent_usd: 0, attempts: 0, usable_outcomes: 0, runs };
  const persist = () => writeFile(file, JSON.stringify(journal, null, 2));
  await persist();
  outer: for (let attempt = 1; attempt <= selection.repetitions; attempt++) for (const id of selection.ids) {
    if (journal.spent_usd + worstCaseAttempt > budget) { journal.stop_reason = "budget"; break outer; }
    const c = suite.cases.find(x => x.id === id)!;
    let observed: ModelReply | undefined;
    const instrumented: ModelClient = { ...client, compare: async (s, sig) => (observed = await client.compare(s, sig)) };
    const started = Date.now();
    const run: Record<string, unknown> = { case_id: c.id, attempt, expected_status: c.expected_status, expected_issue_units: c.issue_units.map(u => u.id) };
    runs.push(run); journal.attempts = runs.length;
    const result = await analyze({ brief: c.brief, scope: c.scope }, instrumented, new AbortController().signal);
    const cost = observed?.usage ? costOf(observed.usage) : null;
    if (cost) journal.spent_usd = +(journal.spent_usd + cost).toFixed(6);
    Object.assign(run, { elapsed_ms: Date.now() - started, technically_usable: !isError(result), displayed_findings: isError(result) ? 0 : result.findings.length, result, provider_reply: observed ?? null, cost_usd: cost });
    if (!isError(result)) journal.usable_outcomes++;
    await persist();
    console.log(JSON.stringify({ progress: `${runs.length}/${selection.planned_attempts}`, case_id: c.id, attempt, outcome: isError(result) ? result.code : result.status, findings: run.displayed_findings, usage: observed?.usage ?? null, cost_usd: cost, spent_usd: journal.spent_usd }));
    if (isError(result) && result.code === "invalid_response" && !observed) { badRequest = "request rejected before any model output (HTTP 4xx)"; journal.stop_reason = `bad_request: ${badRequest}`; console.error("STOP:", badRequest); break outer; }
    if (isError(result) && ["unavailable", "rate_limit"].includes(result.code)) { journal.stop_reason = result.code; break outer; }
  }
  journal.status = journal.attempts === selection.planned_attempts && !journal.stop_reason ? "completed" : "partial";
  journal.finished_at = new Date().toISOString(); await persist();
  console.log(JSON.stringify({ file: fileURLToPath(file), status: journal.status, attempts: journal.attempts, usable: journal.usable_outcomes, spent_usd: journal.spent_usd, stop_reason: journal.stop_reason }));
}
