import { error, LIMITS, type AnalysisError, type ComparisonInput, type Disposition, type ReviewRecord, type ValidatedAnalysis } from "./contracts.ts";
export type Attempt = { id: string; generation: number; snapshot_id: string };
export type SessionState = { generation: number; input: ComparisonInput; phase: "compare" | "loading" | "review"; analysis: ValidatedAnalysis | null; reviews: ReviewRecord[]; drafts: Record<string, string>; revision: number; attempt: Attempt | null; error: AnalysisError | null; recoveryOptIn: boolean; recovered: boolean; backup: Pick<SessionState, "input" | "analysis" | "reviews" | "drafts" | "revision"> | null };
export type SessionEvent = { type: "INPUT"; input: ComparisonInput } | { type: "START"; attempt: Attempt } | { type: "RESULT"; attempt: Attempt; analysis: ValidatedAnalysis } | { type: "ERROR"; attempt: Attempt; error: AnalysisError } | { type: "CANCEL" } | { type: "CLEAR" } | { type: "EDIT" } | { type: "CANCEL_EDIT" } | { type: "DRAFT"; finding_id: string; note: string } | { type: "REVIEW"; finding_id: string; disposition: Disposition; note: string } | { type: "RECOVERY"; enabled: boolean } | { type: "RESTORE"; restored: Pick<SessionState, "input" | "analysis" | "reviews" | "drafts" | "revision"> } | { type: "SAMPLE"; analysis: ValidatedAnalysis };
export function initialState(generation = 0): SessionState { return { generation, input: { project_title: "", brief: "", scope: "" }, phase: "compare", analysis: null, reviews: [], drafts: {}, revision: 0, attempt: null, error: null, recoveryOptIn: false, recovered: false, backup: null }; }
function accept(state: SessionState, analysis: ValidatedAnalysis): SessionState {
  const reviews: ReviewRecord[] = analysis.findings.map((f) => ({ finding_id: f.id, disposition: "open", note: "" }));
  return { ...state, phase: "review", input: { project_title: analysis.sources.project_title, brief: analysis.sources.brief.text, scope: analysis.sources.scope.text }, analysis, reviews, drafts: Object.fromEntries(reviews.map((r) => [r.finding_id, r.note])), revision: 0, attempt: null, error: null, backup: null, recovered: false };
}
function active(state: SessionState, attempt: Attempt) { return state.phase === "loading" && state.attempt?.id === attempt.id && state.generation === attempt.generation && state.attempt.snapshot_id === attempt.snapshot_id; }
export function transition(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "INPUT": return { ...state, generation: state.generation + 1, input: event.input, phase: "compare", analysis: null, reviews: [], drafts: {}, revision: state.revision + 1, attempt: null, error: null, recovered: false };
    case "START": if (state.phase === "loading" || event.attempt.generation !== state.generation) return state; return { ...state, phase: "loading", attempt: event.attempt, analysis: null, reviews: [], drafts: {}, error: null, backup: null };
    case "RESULT": if (!active(state, event.attempt) || event.analysis.snapshot_id !== event.attempt.snapshot_id) return state; return accept(state, event.analysis);
    case "ERROR": if (!active(state, event.attempt)) return state; return { ...state, phase: "compare", attempt: null, error: event.error };
    case "CANCEL": return { ...state, generation: state.generation + 1, phase: "compare", attempt: null, error: error("cancelled") };
    case "CLEAR": return initialState(state.generation + 1);
    case "EDIT": return { ...state, generation: state.generation + 1, phase: "compare", attempt: null, error: null, backup: { input: state.input, analysis: state.analysis, reviews: state.reviews, drafts: state.drafts, revision: state.revision }, analysis: null, reviews: [], drafts: {} };
    case "CANCEL_EDIT": if (!state.backup) return state; return { ...state, ...state.backup, generation: state.generation + 1, phase: state.backup.analysis ? "review" : "compare", attempt: null, error: null, backup: null };
    case "DRAFT": if (event.note.length > LIMITS.note || !state.reviews.some((r) => r.finding_id === event.finding_id)) return state; return { ...state, drafts: { ...state.drafts, [event.finding_id]: event.note }, revision: state.revision + 1 };
    case "REVIEW": if (event.note.length > LIMITS.note || (event.disposition !== "open" && !event.note.trim()) || !state.reviews.some((r) => r.finding_id === event.finding_id)) return state; return { ...state, reviews: state.reviews.map((r) => r.finding_id === event.finding_id ? { ...r, disposition: event.disposition, note: event.note } : r), drafts: { ...state.drafts, [event.finding_id]: event.note }, revision: state.revision + 1 };
    case "RECOVERY": return { ...state, recoveryOptIn: event.enabled };
    case "RESTORE": return { ...initialState(state.generation + 1), ...event.restored, phase: event.restored.analysis ? "review" : "compare", recoveryOptIn: true, recovered: true };
    case "SAMPLE": return accept({ ...state, generation: state.generation + 1 }, event.analysis);
  }
}
export function hasUnsavedNotes(state: SessionState) { return state.reviews.some((r) => (state.drafts[r.finding_id] ?? r.note) !== r.note); }
