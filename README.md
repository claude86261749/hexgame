# Related Work, live

One app with two halves:

- **The map.** A hex-crawl through the literature around DINOv3. 78 papers sit on an island of hex tiles. You walk from tile to tile, and a tile gets its colour only when you mark its paper as read.
- **The live guide.** Any paper that has been turned into diagrams can be talked through, live, by voice. The guide answers in a few spoken sentences and works the diagrams while it talks: it opens the right one, marks it up in orange, or draws a new one for your question.

The two meet on the map. A red dot on a tile's label means a live guide knows that paper; its popup has **Start a live session**. The **Live guide** button in the toolbar lists every paper with a guide and lets you add one. The whole app uses the map's theme.

React front end, a small Node server, `gemini-3.8-flash` for generating diagrams, `gemini-3.8-live` for the spoken guide.

## Run it

```bash
npm install
export GEMINI_API_KEY=...        # or AI_STUDIO_KEY
npm run probe                    # checks the key, both models, JSON schema output, live tools, ephemeral tokens
npm run dev                      # API on :8787, app on http://localhost:5173
```

Two papers come pre-generated in `data/papers/`: DINOv3, which stands on the map, and DeepSeek-R1, which does not. To add a paper, drop a `.md` file in the map's **Live guide** sheet, or:

```bash
npm run fetch:arxiv -- 2508.10104 papers/dinov3.md   # arXiv HTML → Markdown (math kept as $…$)
npm run ingest -- papers/dinov3.md [--force]          # generate from the command line
```

Production: `npm run build && npm start` (serves `dist/` and the API on one port).

## Routes and screens

| Route | Screen |
|---|---|
| `#/` | The map. Toolbar: **Live guide**, Expeditions, Log, Gradients, Run report. Progress on the map is saved in `localStorage`. |
| `#/p/<id>` | One paper, set up for a live session: its diagrams on the left, the diagram and its notes in the middle, the live guide on the right. |
| `#/p/<id>/live` | The same, with a voice session started on arrival. This is where **Start a live session** links. |

In a live session:

- Speak, or type. Each question that gets its own diagram is kept under **Drawn in this session**.
- Talk over the guide to interrupt it, or press Esc. On speakers the guide only stops for a clear voice; tick **Headphones** to interrupt freely.
- You can move between diagrams yourself. The guide is told which one you opened (`Guide.lookingAt`), so the next answer starts from it.
- When a session ends it is saved under `data/papers/<id>/sessions/`, for evals. The app does not replay sessions.

On the map: click a grey tile to walk there and open its paper; <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk, <kbd>R</kbd> marks as read, <kbd>Esc</kbd> closes the popup; drag to pan, scroll or pinch to zoom.

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
- **The guide does not hear itself.** Browser echo cancellation is unreliable for Web Audio playback. Without help, the speaker output leaks into the mic, Gemini's voice detection takes it for the reader, and the guide interrupts and answers itself.
  - `shared/duplex.ts` holds the mic back while the guide is playing. It still lets the reader barge in when the mic is clearly louder than the echo it expects, using the level of what the speaker is playing and a learned room coupling.
  - On a barge-in it forwards 0.5 s of preroll and drops the rest of the interrupted answer. Stop / Esc does the same by hand.
  - A Headphones toggle turns the gate off.
  - The server also sets Gemini's start-of-speech sensitivity to low.
- **One reducer for guide state.** `shared/session.ts` applies each tool call to the screen state. The browser uses it live; the live eval uses it to check what the reader would have seen.
- **The map engine** (`web/src/hex/engine/`) is pure TypeScript with no DOM: affinity from concepts and citations, a diffusion map for the gradients, k-means themes, PageRank elevation, then a hex layout per focal paper. A paper on the map is matched to a generated paper by its short name.

## Layout

| Path | What |
|---|---|
| `prompts/` | System prompts: `style` (house voice), `digest`, `plan`, `spec` + `types/*` (per-type guides with worked examples), `repair`, `factcheck`, `scratch`, `live` |
| `shared/` | Schemas, layout, overlays, tool declarations, executor, session reducer (used by both server and browser) |
| `server/` | Ingestion, model harness (`gemini.ts`: retries, cache, logs, mock mode, repair loop), pipeline, validation, live config, HTTP API |
| `web/src/` | React app: `App.tsx` (routes, generation progress), `Reader.tsx` (a paper with its live guide), live guide client (`live/`), diagram renderer (`diagram/`), styles (`theme.css` holds the shared tokens, `explain.css` the paper screen) |
| `web/src/hex/` | The map: data stand-ins (`data/`), engine, world, game state, canvas (`MapController`, `draw.ts`), components and sheets (`sheets/LiveSheet.tsx` lists papers with a live guide) |
| `eval/` | `run.ts` pipeline eval over a corpus, `live.ts` scripted live-guide eval (can save the session log), `shots.ts` Playwright screenshots |
| `tests/` | Unit tests for ingestion, layout lint, overlays, executor, echo gate, and the map engine and game state (`tests/hex/`) (`npm test`) |

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
npm run eval:live -- <paperId> [--prompt file.md] [--q "question"]…    # text: drives gemini-3.8-live, a flash judge grades each answer (answered / faithful / spoken / screen)
npm run eval:live -- <paperId> --voice --echo 0.5 [--no-gate] [--default-vad] [--save]
    # voice: questions spoken with Gemini TTS and streamed as a live mic in real time; the guide's own audio is mixed back
    # in at --echo gain (a laptop speaker) through the same echo gate as the browser. Reports server interruptions,
    # false barge-ins, how much of what the guide "heard" was its own voice, and whether the questions were heard right.
npm run shots -- <paperId>             # screenshots of every diagram and pipeline step (needs `npm run dev`)
```
