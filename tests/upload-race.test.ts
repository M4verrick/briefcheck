import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { Compare } from "../components/Compare";
import Page from "../app/page";
import { createUploadGuard } from "../lib/session";
import type { ComparisonInput, SourceId } from "../lib/contracts";

// Exercise the component's real file/input callbacks without a DOM dependency.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, mode: "compare", queued: [] as (() => void)[], cleanup: undefined as (() => void) | undefined }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState(initial: unknown) {
    const index = hooks.cursor++; const values = hooks.values;
    if (index >= values.length) values.push(typeof initial === "function" ? initial() : initial);
    return [values[index], (value: unknown) => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  },
  useRef(initial: unknown) { const index = hooks.cursor++; if (index >= hooks.values.length) hooks.values.push({ current: initial }); return hooks.values[index]; },
  useReducer(reducer: (state: unknown, event: unknown) => unknown, initial: unknown, initialize: (initial: unknown) => unknown) {
    const index = hooks.cursor++; const values = hooks.values;
    if (index >= values.length) values.push(initialize(initial));
    return [values[index], (event: unknown) => hooks.queued.push(() => { values[index] = reducer(values[index], event); })];
  },
  useEffect(effect: () => (() => void)) { if (hooks.mode === "compare" && !hooks.cleanup) hooks.cleanup = effect(); },
}));
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.mode = "compare"; hooks.queued = []; hooks.cleanup = undefined; });
afterEach(() => { hooks.cleanup?.(); vi.unstubAllGlobals(); });

function element(tree: unknown, matches: (e: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> {
  const pending = [tree];
  while (pending.length) {
    const item = pending.shift();
    if (Array.isArray(item)) pending.push(...item);
    else if (isValidElement<Record<string, any>>(item)) { if (matches(item)) return item; pending.push(item.props.children); }
  }
  throw new Error("Expected component control was absent");
}
function harness() {
  let input: ComparisonInput = { brief: "Original brief", scope: "Original scope" };
  const uploads = createUploadGuard();
  const changes = vi.fn((id: SourceId, value: string) => { uploads.cancel(id); input = { ...input, [id]: value }; });
  const render = () => {
    hooks.cursor = 0;
    return Compare({ input, uploadGuard: uploads, insertionErrors: { brief: "", scope: "" }, onSourceChange: changes, busy: false, stage: "comparing", slow: false, editing: false, onInput: () => {}, onCompare: () => {}, onCancel: () => {}, onExample: () => {}, onSample: () => {}, onCancelEditing: () => {} });
  };
  const file = (tree: unknown, id: SourceId) => element(tree, (e) => e.type === "input" && e.props["aria-label"] === `Upload a file for ${id === "brief" ? "Client brief" : "Proposed delivery plan"}`);
  return { render, input: () => input, changes, uploads, upload: (tree: unknown, id: SourceId) => file(tree, id).props.onChange({ target: { files: [new File(["Synthetic document"], "source.txt")], value: "source.txt" } }) };
}
function deferred() { let resolve!: (response: Response) => void; const promise = new Promise<Response>((done) => { resolve = done; }); return { promise, resolve }; }
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

it("a delayed upload cannot overwrite newer typing in that source", async () => {
  const pending = deferred(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  const h = harness(); const tree = h.render(); h.upload(tree, "brief");
  element(h.render(), (e) => e.type === "textarea" && e.props.id === "brief").props.onChange({ target: { value: "Newer typed brief" } });
  pending.resolve(Response.json({ ok: true, text: "Old upload text" })); await settle();
  expect(h.input().brief).toBe("Newer typed brief"); expect(h.changes).toHaveBeenCalledTimes(1);
});
it("unmounting Compare for a sample review makes the old upload inactive", async () => {
  const pending = deferred(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  const h = harness(); h.upload(h.render(), "brief"); hooks.cleanup?.();
  pending.resolve(Response.json({ ok: true, text: "Old upload text" })); await settle();
  expect(h.changes).not.toHaveBeenCalled();
});
it("clearing or replacing the session also invalidates an upload without unmounting", async () => {
  const pending = deferred(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  const h = harness(); h.upload(h.render(), "brief"); h.uploads.cancel();
  pending.resolve(Response.json({ ok: true, text: "Old upload text" })); await settle();
  expect(h.changes).not.toHaveBeenCalled();
});
it("independent brief and scope uploads can both complete", async () => {
  const brief = deferred(); const scope = deferred(); vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(brief.promise).mockReturnValueOnce(scope.promise));
  const h = harness(); const tree = h.render(); h.upload(tree, "brief"); h.upload(tree, "scope");
  brief.resolve(Response.json({ ok: true, text: "Uploaded brief" }));
  scope.resolve(Response.json({ ok: true, text: "Uploaded scope" })); await settle();
  expect(h.input()).toEqual({ brief: "Uploaded brief", scope: "Uploaded scope" });
});

it("Page preserves both extraction results when they resolve before a React render", async () => {
  const brief = deferred(); const scope = deferred(); vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(brief.promise).mockReturnValueOnce(scope.promise));
  hooks.mode = "page"; const page = Page(); const pageValues = hooks.values;
  const props = element(page, (e) => e.type === Compare).props as Parameters<typeof Compare>[0];
  hooks.values = []; hooks.cursor = 0; hooks.mode = "compare";
  // Recovery initialization is unrelated; exercise the initialized file callbacks.
  const compare = Compare({ ...props, busy: false });
  for (const name of ["Client brief", "Proposed delivery plan"]) element(compare, (e) => e.type === "input" && e.props["aria-label"] === `Upload a file for ${name}`).props.onChange({ target: { files: [new File(["Synthetic document"], "source.txt")], value: "source.txt" } });
  brief.resolve(Response.json({ ok: true, text: "Uploaded brief" })); scope.resolve(Response.json({ ok: true, text: "Uploaded scope" })); await settle();
  for (const flush of hooks.queued) flush();
  hooks.values = pageValues; hooks.cursor = 0; hooks.mode = "page";
  const completed = element(Page(), (e) => e.type === Compare).props.input;
  expect(completed).toMatchObject({ brief: "Uploaded brief", scope: "Uploaded scope" });
});
