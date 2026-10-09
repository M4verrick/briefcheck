# BriefCheck

Compares a client brief with a delivery plan and flags missing deliverables, conflicting dates and open questions, each backed by exact quotes from the source documents.

## Requirements

- Node.js 24 or later, and npm
- An LLM API key for live comparisons (optional; see below)

## Setup

Create `.env.local` in the project root:

```sh
ANTHROPIC_API_KEY=your-key
# Only for an organization-level key:
ANTHROPIC_WORKSPACE_ID=your-workspace-id
```

Without that key, the app uses a free hosted model if `OPENROUTER_API_KEY` is set instead.

## Run

```sh
npm ci --ignore-scripts
npm run dev
```

Open <http://127.0.0.1:4317>.

- **No key:** click **Explore sample review** to try Review and Report on built-in sample findings.
- **With a key:** click **Use example texts**, then **Compare documents**.

Each document can be pasted or uploaded (button or drag-and-drop): PDF, DOCX, TXT, MD or CSV, up to 10 MB and 16,000 characters of text. Files are parsed by the local server. A file is rejected, and the existing text is kept, when it is empty, mislabelled, damaged, password-protected, an old `.doc`, a scanned PDF with no selectable text, not UTF-8 text, or over the limit.

Use synthetic documents only: both texts are sent to the model provider.

## Test

```sh
npm run typecheck
npm run test:unit
npm run test:e2e   # uses installed Chrome; set its path in playwright.config.ts if needed
npm run build
```
