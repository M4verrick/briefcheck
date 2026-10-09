"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { Compare } from "../components/Compare";
import { Review } from "../components/Review";
import { Report } from "../components/Report";
import { error, isError, LIMITS, type ComparisonInput } from "../lib/contracts";
import { makeSnapshot } from "../lib/evidence";
import { restoreDraft, saveDraft, verifyAnalysis } from "../lib/recovery";
import { buildReport, type ReportDocument } from "../lib/report";
import { SAMPLE_INPUT, sampleAnalysis } from "../lib/sample";
import { hasUnsavedNotes, initialState, transition } from "../lib/session";
type View = "compare" | "review" | "report";
export default function Page() {
  const [state, dispatch] = useReducer(transition, undefined, () => initialState()); const current = useRef(state); current.current = state;
  const [selectedFinding, setSelectedFinding] = useState(""); const [view, setView] = useState<View>("compare"); const [report, setReport] = useState<ReportDocument | null>(null); const [initialized, setInitialized] = useState(false); const [notice, setNotice] = useState(""); const [stage, setStage] = useState("comparing"); const [slow, setSlow] = useState(false); const [preparing, setPreparing] = useState(false);
  const inflight = useRef<AbortController | null>(null); const [modal, setModal] = useState<{ kind: "clear" | "sample" | "example" } | null>(null); const dialog = useRef<HTMLDivElement>(null); const modalOpener = useRef<HTMLElement | null>(null);
  const [insertionErrors, setInsertionErrors] = useState({ brief: "", scope: "" });
  useEffect(() => { let alive = true; (async () => { let restored; try { restored = await restoreDraft(window.sessionStorage); } catch { restored = error("storage_unavailable"); } if (!alive) return; if (isError(restored)) setNotice(restored.message); else if (restored) { dispatch({ type: "RESTORE", restored }); if (restored.analysis) setView("review"); } setInitialized(true); })(); return () => { alive = false; }; }, []);
  useEffect(() => { if (!initialized) return; try { const result = saveDraft(state, window.sessionStorage); if (!result.ok) setNotice(result.error.message); else if (state.recoveryOptIn) setNotice(""); } catch { setNotice(error("storage_unavailable").message); } }, [state, initialized]);
  useEffect(() => { setSlow(false); if (state.phase !== "loading") return; const timer = setTimeout(() => setSlow(true), 15_000); return () => clearTimeout(timer); }, [state.phase, state.attempt?.id]);
  useEffect(() => () => inflight.current?.abort(), []);
  useEffect(() => { if (!modal) return; modalOpener.current = document.activeElement as HTMLElement; const box = dialog.current; box?.querySelector<HTMLButtonElement>("button")?.focus(); const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { setModal(null); return; } if (e.key !== "Tab") return; const buttons = Array.from(box?.querySelectorAll<HTMLButtonElement>("button") ?? []); const first = buttons[0]; const last = buttons.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }; document.addEventListener("keydown", handler); return () => { document.removeEventListener("keydown", handler); modalOpener.current?.focus(); }; }, [modal]);
  function inputChanged(input: ComparisonInput) { inflight.current?.abort(); inflight.current = null; setPreparing(false); dispatch({ type: "INPUT", input }); }
  function sourceChanged(id: "brief" | "scope", value: string) {
    if (value.length > LIMITS.source) {
      const label = id === "brief" ? "Client brief" : "Proposed delivery plan";
      setInsertionErrors((previous) => ({ ...previous, [id]: `${label} insertion was rejected because it exceeds 16,000 characters. Previous text is unchanged. Shorten the text and try again.` }));
      return;
    }
    setInsertionErrors((previous) => ({ ...previous, [id]: "" }));
    inputChanged({ ...current.current.input, [id]: value });
  }
  async function compare() {
    if (!initialized || inflight.current || current.current.phase === "loading" || insertionErrors.brief || insertionErrors.scope) return;
    const controller = new AbortController(); inflight.current = controller; setPreparing(true); const before = current.current; let sources;
    try { sources = await makeSnapshot(before.input); } catch { inflight.current = null; setPreparing(false); return; }
    if (controller.signal.aborted || current.current.generation !== before.generation) return;
    const attempt = { id: crypto.randomUUID(), generation: before.generation, snapshot_id: sources.identity }; dispatch({ type: "START", attempt }); setStage("comparing"); setPreparing(false); setView("compare");
    let timedOut = false; const cutoff = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(before.input), signal: controller.signal, cache: "no-store" });
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("ok" in body)) { dispatch({ type: "ERROR", attempt, error: error("invalid_response") }); return; }
      if (!response.ok || body.ok !== true) {
        const supplied = "error" in body && isError(body.error) ? body.error : null;
        const code = supplied && ["invalid_input", "unavailable", "timeout", "rate_limit", "capacity", "invalid_response", "invalid_evidence", "refused", "cancelled"].includes(supplied.code) ? supplied.code : "network";
        dispatch({ type: "ERROR", attempt, error: error(code) }); return;
      }
      setStage("checking"); const validated = await verifyAnalysis("analysis" in body ? body.analysis : null, before.input);
      if (isError(validated)) dispatch({ type: "ERROR", attempt, error: error("invalid_evidence") });
      else { dispatch({ type: "RESULT", attempt, analysis: validated }); if (current.current.generation === attempt.generation && !controller.signal.aborted) setView("review"); }
    } catch { dispatch({ type: "ERROR", attempt, error: error(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network") }); }
    finally { clearTimeout(cutoff); if (inflight.current === controller) { inflight.current = null; setPreparing(false); } }
  }
  function cancel() { inflight.current?.abort(); inflight.current = null; setPreparing(false); dispatch({ type: "CANCEL" }); }
  async function perform(kind: "clear" | "sample" | "example") {
    setModal(null); inflight.current?.abort(); inflight.current = null; setReport(null); setNotice("");
    setInsertionErrors({ brief: "", scope: "" });
    if (kind === "clear") { dispatch({ type: "CLEAR" }); setView("compare"); }
    else if (kind === "example") { dispatch({ type: "INPUT", input: SAMPLE_INPUT }); setView("compare"); }
    else { const generation = current.current.generation; setPreparing(true); const analysis = await sampleAnalysis(); if (current.current.generation === generation) { dispatch({ type: "SAMPLE", analysis }); setView("review"); } setPreparing(false); }
  }
  function request(kind: "clear" | "sample" | "example") { if (state.input.brief || state.input.scope || state.analysis) setModal({ kind }); else void perform(kind); }
  function refresh(include_dismissed = report?.options.include_dismissed ?? false) { if (!state.analysis || hasUnsavedNotes(state) || state.analysis.status === "not_comparable") return; setReport(buildReport(state.analysis, state.reviews, { include_dismissed, review_revision: state.revision })); setView("report"); }
  function beginEditing() {
    inflight.current?.abort(); inflight.current = null; setPreparing(false);
    setInsertionErrors({ brief: "", scope: "" });
    if (current.current.analysis) dispatch({ type: "EDIT" });
    setView("compare");
  }
  function navigate(next: View) { if (next === "compare" && current.current.analysis) beginEditing(); else if (next === "report" && !report) refresh(false); else setView(next); }
  const outdated = !!report && (!state.analysis || report.analysis.analysis_id !== state.analysis.analysis_id || report.options.review_revision !== state.revision); const unsaved = hasUnsavedNotes(state);
  return <div className="app-shell">
    <header className="app-header no-print"><a className="brand" href="#main"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h6m5-1 2 2 4-5" /></svg></span>BriefCheck</a><nav className="workflow-nav" aria-label="Workflow">{(["compare", "review", "report"] as const).map((step, i) => <button key={step} aria-current={view === step ? "step" : undefined} className={view !== step && (step === "compare" ? !!state.analysis : step === "review" ? view === "report" : false) ? "done" : undefined} disabled={!initialized || (step !== "compare" && !state.analysis) || (step === "report" && state.analysis?.status === "not_comparable")} onClick={() => navigate(step)}><span>0{i + 1}</span> {step[0].toUpperCase() + step.slice(1)}</button>)}</nav><button className="clear-button" onClick={() => request("clear")} disabled={!initialized}>Clear session</button></header>
    <main id="main" className={view === "compare" ? "compare-main" : "workspace-main"}>
    {state.recovered && <p className="recovered no-print"><strong>Recovered local draft</strong> · No new analysis request was made.</p>}
    {notice && <div className="error-box no-print" role="alert">{notice}</div>}
    {state.error && <div className="error-box no-print" role="alert"><div><strong>{state.error.message}</strong><p>No findings were accepted from this attempt.</p></div>{state.input.brief.trim() && state.input.scope.trim() && <button disabled={!!insertionErrors.brief || !!insertionErrors.scope || preparing || state.phase === "loading"} onClick={compare}>Retry comparison</button>}</div>}
    {view === "compare" && <Compare input={state.input} insertionErrors={insertionErrors} onSourceChange={sourceChanged} busy={state.phase === "loading" || preparing || !initialized} stage={stage} slow={slow} editing={!!state.backup} onInput={inputChanged} onCompare={compare} onCancel={cancel} onExample={() => request("example")} onSample={() => request("sample")} onCancelEditing={() => { setInsertionErrors({ brief: "", scope: "" }); dispatch({ type: "CANCEL_EDIT" }); setView("review"); }} />}
    {view === "review" && state.analysis && <Review selected={selectedFinding} onSelect={setSelectedFinding} state={state} dispatch={dispatch} onEdit={beginEditing} onReport={() => refresh(false)} />}
    {view === "report" && report && <Report report={report} outdated={outdated} unsaved={unsaved} onRefresh={refresh} />}
    </main>
    <footer className="session-footer no-print"><div><strong>Session privacy</strong><p>Work is held in memory and cleared when you reload or close this tab. Exported reports are saved only where you choose.</p></div><div><label className="checkbox-label"><input type="checkbox" checked={state.recoveryOptIn} onChange={(e) => { dispatch({ type: "RECOVERY", enabled: e.target.checked }); if (!e.target.checked) setNotice(""); }} disabled={!initialized} />Keep this draft in this tab</label><p>Keeps your documents, findings and notes in this browser tab so a reload does not lose them. Not a backup; closing the tab clears it.</p></div></footer>
    {modal && <div className="modal-backdrop"><div className="modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{modal.kind === "clear" ? "Clear this session?" : "Replace this session?"}</h2><p>{modal.kind === "clear" ? "This removes BriefCheck’s inputs, findings, notes and saved tab draft. It cannot remove downloaded reports or recall a request already received remotely." : "The example will replace your current inputs and review. Your downloaded reports stay unchanged."}</p><div className="button-row"><button onClick={() => setModal(null)}>Keep working</button><button className="primary" onClick={() => void perform(modal.kind)}>{modal.kind === "clear" ? "Clear this session" : "Replace and continue"}</button></div></div></div>}
  </div>;
}
