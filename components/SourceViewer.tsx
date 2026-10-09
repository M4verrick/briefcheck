import { useEffect, useRef, useState } from "react";
import type { EvidenceSpan, SnapshotPair, SourceId } from "../lib/contracts";
export function SourceViewer({ sources, evidence }: { sources: SnapshotPair; evidence: EvidenceSpan | null }) {
  const [id, setId] = useState<SourceId>("brief"); const [open, setOpen] = useState(true); const mark = useRef<HTMLElement>(null);
  useEffect(() => { setOpen(window.innerWidth >= 1100); }, []);
  useEffect(() => { if (evidence) { setId(evidence.source_id); setOpen(true); } }, [evidence]);
  useEffect(() => { if (evidence && open && id === evidence.source_id) { mark.current?.focus({ preventScroll: true }); mark.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); } }, [evidence, open, id]);
  const source = sources[id]; const active = evidence?.source_id === id ? evidence : null;
  const firstMatchedLine = active ? source.lines.find((line) => Math.max(line.start, active.start_offset) < Math.min(line.end, active.end_offset))?.number : null;
  return <aside className="source-panel"><details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}><summary><span>Source documents</span><span className="muted">Read the full context</span></summary><div className="source-tabs"><button aria-pressed={id === "brief"} onClick={() => setId("brief")}>Client brief</button><button aria-pressed={id === "scope"} onClick={() => setId("scope")}>Delivery plan</button></div><div className="source-content" aria-label={`${id === "brief" ? "Client brief" : "Proposed delivery plan"} source text`}>{source.lines.map((line) => {
    const start = active ? Math.max(line.start, active.start_offset) : 0; const end = active ? Math.min(line.end, active.end_offset) : 0; const matched = !!active && start < end;
    return <div className="source-line" key={line.number}><span className="line-number" aria-hidden="true">{line.number}</span><div>{matched ? <>{source.text.slice(line.start, start)}<mark ref={line.number === firstMatchedLine ? mark : undefined} tabIndex={-1}>{source.text.slice(start, end)}</mark>{source.text.slice(end, line.end)}</> : source.text.slice(line.start, line.end) || "\u200b"}</div></div>;
  })}</div><p className="source-footnote">Quotes match the submitted text. Meaning still needs your judgment.</p></details></aside>;
}
