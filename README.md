# BriefCheck

Compare a client brief with a proposed delivery plan, inspect exact source quotes, and turn unresolved findings into a clarification agenda. Findings cover missing deliverables, conflicting commitments and open questions. You record the outcome; the original evidence stays unchanged.

## Run locally

Requires Node.js 24 or later and npm.

```sh
npm ci --ignore-scripts
npm run dev
```

Open <http://127.0.0.1:4317>. No API key is needed for the sample walkthrough.

### Try the sample

1. Select **Explore sample review**. The findings are hand-authored and labelled **Sample data**; no model request is made.
2. Select a finding, then a line reference to read its source context. **Back to finding evidence** returns to the citation.
3. Add a note. **Save Open note** keeps the question on the agenda. **Record decision** and **Dismiss finding** require a note; **Reopen finding** preserves it.
4. Use **Next finding** to continue, then **Preview agenda** on the last finding, or **Preview report** at any time after saving notes.
5. Review the open-question agenda and the evidence/notes below it. Copy or download Markdown, or print/save as PDF. Exports are generated locally without another model request; browser permissions may be required.

**Use example texts** only fills the input fields. Selecting **Compare documents** afterward makes a live request if a provider is configured; it is separate from the offline sample walkthrough.

## Live comparisons

Copy the blank `.env.example` to `.env.local` and configure only credentials you are authorized to use. Never commit `.env.local`.

The current selection policy is:

| Configuration | Selected route |
|---|---|
| `ANTHROPIC_API_KEY` present | Anthropic `claude-opus-5-5`, medium effort; `ANTHROPIC_WORKSPACE_ID` is required for an organization-level key |
| No Anthropic key; `OPENROUTER_API_KEY` present | OpenRouter `nvidia/nemotron-3-super-120b-a12b:free`, pinned to Nvidia with zero-price caps and provider fallbacks disabled |
| Neither key present | Live comparison is unavailable; the sample still works |

If both keys are present, Anthropic wins. A key or workspace ID does not establish free usage or sponsor-credit entitlement. Confirm billing, available credits and authorization before a live request. The app does not automatically switch providers after an error. Cancellation stops waiting locally but cannot recall a request already received by a provider.

Each document can be pasted or uploaded (button or drag-and-drop): PDF, DOCX, TXT, MD or CSV, up to 10 MB and 16,000 extracted characters per source. Files are parsed by the local server. Unreadable, empty, mislabelled, damaged, password-protected or oversized files are rejected without replacing existing text; scanned PDFs need selectable text, and legacy `.doc` files are unsupported. Check extracted text before comparing.

Use synthetic documents for testing. Live comparison sends both source texts to the selected provider, which may retain them under its own policy. The project title accompanies the request to the local server but is excluded from the model prompt. Review notes remain in the browser.

## Review and export guarantees

- Quotes must match the submitted source text, line ranges and canonical offsets. An invalid citation rejects the whole result. **Quote matched** verifies text, not the interpretation or completeness of the scope.
- Cards use a consistent type order: missing from scope, conflict, clarification. Reports group by disposition and preserve that type order within each section. Dismissed findings are omitted unless explicitly included.
- Decisions are user-reported; client assent is not verified. Zero findings and a completed review do not certify a complete scope.
- Notes do not edit the source evidence. Unsaved notes and changes after a report preview block export until the notes are saved and the preview is refreshed, including native printing of a stale report.
- **Edit sources** makes previous findings inactive. **Cancel editing** restores the previous sources and review; a new comparison starts a fresh review. Late responses cannot replace a newer attempt.
- Work is held in memory by default. Optional **Keep this draft in this tab** uses validated browser session storage for reload recovery; closing the tab clears it. Downloaded reports remain where you saved them.

## Local verification

```sh
npm run typecheck
npm run test:unit
npm run build
```

Unit tests use fixtures and mocked providers. They cover citation validation, immutable reports, review identity, stale/late results, input limits and provider policy. A build does not perform a live model evaluation.

Use the in-app browser first for interactive testing. Check the sample walkthrough above, keyboard focus and source-return navigation, a narrow viewport, unsaved-note export blocking, and preview refresh. Use standalone Chrome only when a required check cannot be completed in the in-app browser, and record the reason.

The optional existing Playwright harness (`npm run test:e2e`) currently targets installed Chrome via `playwright.config.ts`; it is a separate automated suite, not the in-app browser. It blanks model keys, uses fixtures/mocks and writes screenshots/reports to ignored `evidence/` and `test-results/`. Preserve historical evidence before rerunning it. Browser download or print permission failures limit those checks; they do not imply that the review was lost.

Live model evaluation is separate from local tests. The default commands below only validate their plans; adding `--enable-live` makes remote requests and requires separate authorization. Free-model checks verify available quota and endpoint pricing first. Do not assume the paid evaluator is covered by sponsor credits.

```sh
npm run eval:model -- --cases=E01 --repetitions=1
npm run eval:provider -- --cases=E01 --repetitions=1
```

Synthetic regression cases and a held-out corpus live in `eval/`. Keep the held-out set evaluation-only. Schema/citation success does not measure semantic accuracy; inspect findings and uncertainty separately. Private journals, evaluation reviews, submission assets and historical planning records are excluded from the public repository.

## Code map

- `app/page.tsx` and `components/`: Compare → Review → Report workflow and source viewer.
- `lib/evidence.ts`, `lib/model-output.ts`, `lib/analysis.ts`: canonical sources, model-output decoding and citation validation.
- `lib/session.ts`, `lib/recovery.ts`: attempt identity, review state and optional tab recovery.
- `lib/findings.ts`, `lib/report.ts`: shared presentation order and frozen Markdown/report data.
- `lib/provider.ts`: server-only provider selection and request policy.

BriefCheck runs locally on port 4317. The analysis endpoint currently validates local host/origin values; this repository is not a ready-to-deploy hosted service.
