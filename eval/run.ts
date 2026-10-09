import { readFile, mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { openRouterClient, OPENROUTER_MODEL } from "../lib/provider.ts";
import { analyze } from "../lib/analysis.ts";
import { isError, ModelProviderError, type ModelClient, type ModelReply, type SnapshotPair } from "../lib/contracts.ts";
import { makeSnapshot, sha256 } from "../lib/evidence.ts";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "../lib/prompt.ts";
import { freeReadiness } from "./free-readiness.ts";
import { evaluationBudgetStop, evaluationSelection, loadSuite } from "./selection.ts";

const { cases: frozenCases, sha256: fingerprint } = await loadSuite("frozen");
const suite = { cases: frozenCases };
const selection = evaluationSelection(process.argv.slice(2), suite.cases.map(c => c.id));
const selectedCases = selection.ids.map(id => suite.cases.find(c => c.id === id)!);
if (!process.argv.includes("--enable-live")) {
  console.log(JSON.stringify({ mode: "offline-suite-check", cases: selectedCases.length, frozen_corpus_cases: 15, selected_case_ids: selection.ids, repetitions: selection.repetitions, planned_attempts: selection.planned_attempts, authored_evidence: "matched", suite_sha256: fingerprint, live_calls: 0, semantic_accuracy: "unmeasured", note: "Use --enable-live only for the owner-authorized pinned free endpoint. No paid fallback; the full 45-attempt suite needs at least 45 remaining free requests. Targeted selections preserve the corpus and actual denominators." }, null, 2));
} else {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    try { loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url))); }
    catch { /* Missing local credentials are handled by the fail-closed provider. */ }
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) { console.error("STOP: No authorized server-side provider key. No live requests made."); process.exitCode = 1; }
  else {
    const client = openRouterClient(key);
    const directory = new URL("./runs/", import.meta.url);
    await mkdir(directory, { recursive: true });
    const file = new URL(`./runs/${new Date().toISOString().replaceAll(":", "-")}.json`, import.meta.url);
    const runs: Record<string, unknown>[] = [];
    const readiness_checks: Awaited<ReturnType<typeof freeReadiness>>[] = [];
    const journal = {
      schema_version: 2, synthetic: true, authored_regression_suite: true, started_at: new Date().toISOString(), finished_at: null as string | null,
      status: "running", stop_reason: null as string | null, planned_attempts: selection.planned_attempts, selected_case_ids: selection.ids, repetitions: selection.repetitions, full_suite: selection.full_suite, attempts: 0, completed_attempts: 0, usable_outcomes: 0,
      suite_sha256: fingerprint, provider: client.provider, model: client.model, prompt_version: PROMPT_VERSION, prompt_sha256: await sha256(SYSTEM_PROMPT),
      provider_sha256: await sha256(await readFile(new URL("../lib/provider.ts", import.meta.url), "utf8")),
      output_contract: "line-selection-v2", output_handler_sha256: await sha256(await readFile(new URL("../lib/model-output.ts", import.meta.url), "utf8")),
      validation_boundary_sha256: await sha256(await readFile(new URL("../lib/evidence.ts", import.meta.url), "utf8")),
      request_policy: { only_provider: "nvidia", max_price_usd: 0, max_tokens: 8192, temperature: 0, attempts_limit: selection.planned_attempts, concurrency: 1, min_interval_ms: 4000, automatic_retries: 0, reserved_free_requests: 0 },
      semantic_precision: null, semantic_recall: null, manual_review_required: true, readiness_checks, runs,
    };
    const persist = () => writeFile(file, JSON.stringify(journal, null, 2));
    await persist();
    let interrupted = false;
    const onInterrupt = () => { interrupted = true; };
    process.once("SIGINT", onInterrupt); process.once("SIGTERM", onInterrupt);
    try {
      if (client.model !== OPENROUTER_MODEL || client.provider !== "openrouter") throw new ModelProviderError("unavailable");
      const initial = await freeReadiness(key); readiness_checks.push(initial);
      journal.stop_reason = evaluationBudgetStop(selection.full_suite, selection.planned_attempts, initial.free_requests.remaining); await persist();
      let previousStarted = 0;
      if (!journal.stop_reason) {
      outer: for (let attempt = 1; attempt <= selection.repetitions; attempt++) for (const c of selectedCases) {
        if (interrupted) { journal.stop_reason = "interrupted"; break outer; }
        const quota = await freeReadiness(key, false); readiness_checks.push(quota);
        if (quota.free_requests.remaining <= 0) { journal.stop_reason = "exhausted_free_quota"; break outer; }
        const waitMs = Math.max(0, 4000 - (Date.now() - previousStarted)); if (waitMs) await delay(waitMs);
        let observed: ModelReply | undefined;
        let providerFailure: ModelProviderError | undefined;
        const instrumented: ModelClient = { provider: client.provider, model: client.model, compare: async (sources: SnapshotPair, signal: AbortSignal) => {
          try { observed = await client.compare(sources, signal); return observed; }
          catch (cause) { if (cause instanceof ModelProviderError) providerFailure = cause; throw cause; }
        } };
        const sources = await makeSnapshot({ brief: c.brief, scope: c.scope });
        const run: Record<string, unknown> = { case_id: c.id, attempt, state: "started", started_at: new Date().toISOString(), source_hashes: { brief: sources.brief.sha256, scope: sources.scope.sha256 }, expected_status: c.expected_status, expected_issue_units: c.issue_units.map(u => u.id) };
        runs.push(run); journal.attempts = runs.length; await persist(); previousStarted = Date.now();
        const result = await analyze({ brief: c.brief, scope: c.scope }, instrumented, new AbortController().signal);
        Object.assign(run, {
          state: "completed", finished_at: new Date().toISOString(), elapsed_ms: Date.now() - previousStarted,
          technically_usable: !isError(result), displayed_findings: isError(result) ? 0 : result.findings.length, result,
          provider_reply: observed ?? null, provider_error_telemetry: providerFailure?.telemetry ?? null,
          actual_cost_usd: observed?.telemetry?.cost_usd ?? providerFailure?.telemetry?.cost_usd ?? null,
          manual_judgment: { supported_finding_ids: null, found_issue_units: null, false_gaps: null, false_conflicts: null, useful_questions: null, grounded_consequence_finding_ids: null, unsupported_consequence_finding_ids: null, actionable_clarification_finding_ids: null, critical_gate_pass: null },
        });
        journal.completed_attempts++; if (!isError(result)) journal.usable_outcomes++;
        await persist();
        console.log(JSON.stringify({ progress: `${journal.completed_attempts}/${selection.planned_attempts}`, case_id: c.id, repetition: attempt, outcome: isError(result) ? result.code : result.status, findings: run.displayed_findings, usage: observed?.usage ?? null, cost_usd: run.actual_cost_usd, elapsed_ms: run.elapsed_ms }));
        if (isError(result) && ["unavailable", "rate_limit"].includes(result.code)) { journal.stop_reason = result.code; break outer; }
      }
      }
      readiness_checks.push(await freeReadiness(key, false));
      journal.status = journal.completed_attempts === selection.planned_attempts ? "completed" : "partial";
    } catch (cause) {
      journal.status = "partial";
      journal.stop_reason = cause instanceof ModelProviderError ? `readiness_${cause.code}` : "readiness_or_persistence_failed";
    } finally {
      journal.finished_at = new Date().toISOString(); await persist();
      process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onInterrupt);
    }
    console.log(JSON.stringify({ file: fileURLToPath(file), status: journal.status, attempts: journal.attempts, completed: journal.completed_attempts, usable: journal.usable_outcomes, stop_reason: journal.stop_reason, manual_review_required: true }));
    if (journal.status !== "completed") process.exitCode = 1;
  }
}
