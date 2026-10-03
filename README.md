# Papers, explained in diagrams

Turn any research paper (as Markdown) into a short sequence of interactive diagrams, plus a live guide you can talk to that draws new diagrams for your questions. React front end, a small Node server, `gemini-3.8-flash` for generating diagrams, `gemini-3.8-live` for the spoken guide.

The DINOv3 prototype this grew from is the design reference. Everything paper-specific is now generated.

## Run it

```bash
npm install
export GEMINI_API_KEY=...        # or AI_STUDIO_KEY
npm run probe                    # checks the key, both models, JSON schema output, live tools, ephemeral tokens
npm run dev                      # API on :8787, app on http://localhost:5173
```

Two papers come pre-generated in `data/papers/` (DINOv3 and DeepSeek-R1), each with a recorded guide session to play back. To add a paper, drop a `.md` file on the library page, or:

```bash
npm run fetch:arxiv -- 2508.10104 papers/dinov3.md   # arXiv HTML → Markdown (math kept as $…$)
npm run ingest -- papers/dinov3.md [--force]          # generate from the command line
```

Production: `npm run build && npm start` (serves `dist/` and the API on one port).

## How it works

```
paper.md ─ ingest ─▶ PaperDoc (sections with stable ids: s4.2, sA.1, refs)
                         │
   gemini-3.8-flash      ▼
   digest ─▶ plan ─▶ one spec per diagram (parallel) ─▶ validate + layout lint ─▶ repair (≤2) ─▶ fallback to flow ─▶ drop
                                                                    │
   landscape map built from the digest (no model call) ◀────────────┘ ─▶ fact-check every sentence ─▶ diagrams.json
```

- **Models write JSON, never SVG.** `shared/schema.ts` defines eight diagram types (`flow`, `pipeline`, `chart`, `matrix`, `compare`, `sim`, `landscape`, `free`). Generation is constrained by JSON Schema derived from the same zod schemas.
- **One layout engine, two users.** `shared/layout.ts` is pure TypeScript. The browser renders with it, and the server lints with it: overflowing labels, flows too deep for left-to-right, edge labels colliding with boxes, curves drawn on top of each other. Lint errors go back to the model as repair instructions.
- **Live guide.** The server mints a single-use ephemeral token and builds the session config: system prompt, diagram manifest, section index and tools. The browser then talks to `gemini-3.8-live` directly, with audio both ways.
  - The guide's tools: `show_diagram`, `start_custom`, `add_step` (orange overlay ops anchored to element ids), `draw_from_scratch`, `finish_custom` and `read_section`.
  - `draw_from_scratch` is a non-blocking call: flash draws the diagram while the guide keeps talking.
  - Every tool call is validated by `shared/executor.ts`. Bad calls return an error the model can act on, such as "`dense_peak` belongs to g2; start a new custom diagram with base g2".
- **Sessions replay exactly.** A session is a timed log of transcript chunks and tool calls. The same reducer (`shared/session.ts`) drives the live screen and replay, so the player rebuilds what the reader saw at any moment.

## Layout

| Path | What |
|---|---|
| `prompts/` | System prompts: `style` (house voice), `digest`, `plan`, `spec` + `types/*` (per-type guides with worked examples), `repair`, `factcheck`, `scratch`, `live` |
| `shared/` | Schemas, layout, overlays, tool declarations, executor, session reducer (used by both server and browser) |
| `server/` | Ingestion, model harness (`gemini.ts`: retries, cache, logs, mock mode, repair loop), pipeline, validation, live config, HTTP API |
| `web/src/` | React app: library, generation progress, reader (three columns as in the prototype), live guide client (`live/`), renderer (`diagram/Stage.tsx`) |
| `eval/` | `run.ts` pipeline eval over a corpus, `live.ts` scripted live-guide eval (saves a replayable session), `shots.ts` Playwright screenshots |
| `tests/` | Unit tests for ingestion, layout lint, overlays, executor/replay (`npm test`) |

## Harness knobs

- `GEMINI_MOCK=1` replays cached model responses only (no key; fails on a cache miss).
- `GEMINI_NO_CACHE=1` forces fresh calls.
- `GEMINI_CONCURRENCY` (default 6).
- `FLASH_MODEL` / `LIVE_MODEL` / `LIVE_VOICE`.
- `DATA_DIR` (default `./data`).
- Every model call is logged to `data/logs/calls.jsonl` (stage, latency, tokens, finish reason).

## Evals

```bash
npm run eval -- papers/*.md            # per paper: diagrams kept/dropped, repairs, lint issues, bad citations, fact-check rewrites, tokens
npm run eval:live -- <paperId> ["question" …]   # drives gemini-3.8-live over text; checks tool errors and draw-before-speak
npm run shots -- <paperId>             # screenshots of every diagram and pipeline step (needs `npm run dev`)
```
