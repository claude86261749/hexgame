# Paper-in-diagrams: implementation plan

Goal: rebuild the DINOv3 "explained in diagrams" prototype as a React app that works for
**any paper supplied as Markdown**. `gemini-3.8-flash` generates the general diagrams from
the paper. `gemini-3.8-live` runs the spoken or typed guide, which draws custom diagrams
in answer to the reader's questions. Sessions are recorded and can be replayed.

Status: **MVP implemented** (see README.md). Milestones M0–M4 are done; M5 has a first corpus of two papers; M6 is partial. See §12 for what's verified and what isn't.

---

## 0. Gemini access check (verified)

The key is read from env var **`AI_STUDIO_KEY`**. It is sent as the `x-goog-api-key` header and is never put in a URL.
Probe run on 2026-10-03 with `@google/genai`:

| Check | Result |
|---|---|
| `models.list` | 200 OK; 61 models visible |
| `gemini-3.8-flash` | exists; 1,048,576 in / 65,536 out; `generateContent`, `createCachedContent`, `batchGenerateContent` |
| flash JSON mode with `responseSchema` | valid schema-conforming JSON in ~2.6 s (thinking is on by default: 471 thought tokens for a tiny prompt, so set a per-stage thinking budget) |
| `gemini-3.8-live` | exists; 131,072 in / 65,536 out; `bidiGenerateContent` |
| live: text in → function call | `show_diagram({id:"g2", part:"pretraining"})` arrives **as its own turn, before any speech** (fits the "draw, then talk" rule) |
| live: after tool response | spoken reply, AUDIO 24 kHz PCM (~136 KB), and `outputAudioTranscription` text ("Here is the pretraining step of the training pipeline.") |
| ephemeral token (`authTokens.create`, v1alpha) | created; a Live session opened **with the token only** has the same tool call, audio and transcription → the browser connects directly; no relay needed |
| latency | live session connect → tool call → end of spoken turn: ~4.4 s (API key), ~5.8 s (ephemeral) |

Also available if we need them: `gemini-3.8-live-extended-thinking` (a slower, deeper guide), `gemini-3.8-flash-tts`,
`gemini-embedding-2` (section retrieval for long papers), and `gemini-3.5-transcribe-live`.

`npm run probe` (M0) turns this check into a script and writes `server/model-capabilities.json`. Model IDs live in config.

---

## 1. What the prototype does (what we must reproduce)

Layout: header (title, byline, gist) and three columns: **TOC** | **stage** (SVG, 560×360 viewBox) | **reading panel / transcript**.
Below 1100 px wide the TOC becomes a row and the stage is pinned. Light and dark themes come from tokens.

- **General diagrams** (6 for DINOv3), each with a heading, body, hint and Back/Next buttons:
  - *parts*: selectable nodes; the panel shows the note for the selected part (g1 backbone→heads, g2 pipeline + detail frame, g4 Gram anchoring)
  - *scrub chart*: pointer x drives the curves and a linked panel (g3 "what breaks at scale")
  - *toy simulation*: hover a cell and the maps recompute (g5)
  - *landscape*: an isometric hex map of related papers (relation = colour, reliance = height) plus hatched "open direction" tiles (g6)
- **Custom diagrams** ("made for a question you asked") come in two kinds. Some start from a general
  diagram, are drawn in its *still* state, and add **orange overlay steps**. Others are drawn from scratch.
- **Recorded session**: a transcript (You / Guide) synced to the diagram steps, with play/pause/seek/speed controls,
  per-word highlighting, chapter cuts on the track and keyboard control.
- **Editorial voice**: plain short sentences and no hype. Schematic curves are labelled schematic,
  toy simulations are labelled as toys, and the guide's own suggestions are labelled as not the authors'.

Everything paper-specific in the prototype is hand-written SVG. **Making it data-driven is the main work.**

---

## 2. Architecture

```
/shared      zod schemas + TS types: PaperDoc, Digest, DiagramSpec, Overlay, Tool args, SessionLog
/server      Node 22 + Hono. Holds the key (`AI_STUDIO_KEY`). Never ships it to the browser.
  ingest/      .md → PaperDoc
  generate/    flash pipeline (digest → plan → specs → validate/repair → fact-check)
  live/        ephemeral-token minting; WS relay fallback
  harness/     model-call wrapper: retries, timeouts, caching, logging, mock replay
  store/       data/papers/<sha>/{paper.md, doc.json, digest.json, diagrams.json, sessions/*.json}
/web         Vite + React 19 + TS
  diagram/     DiagramSpec → SVG renderer (one component per type) + overlay layer
  layout/      elkjs auto-layout, text measurement, hex layout
  live/        Live client, AudioWorklets (mic 16 kHz PCM16, playback 24 kHz), tool executor
  session/     recorder + player
  app/         shell (TOC / stage / side), routing, theme
/prompts     system prompts as .md with {{slots}}; loaded by server and by live client config
/eval        offline harness over a corpus of .md papers
```

Stack choices (defaults; tell me to change them): `@google/genai` SDK, zod, elkjs, remark/unified
(+ remark-gfm, remark-math), Hono, Vitest, Playwright (screenshots and e2e). No CSS framework:
port the prototype's tokens and CSS directly.

**Why a server**: the key cannot reach the browser. For Live, the browser connects straight to
Gemini with a short-lived **ephemeral token** that is locked to the live model, our system
instruction and our tools. That keeps audio latency low. If the live model rejects ephemeral tokens, the fallback is
a WS relay through `/server/live/relay`.

---

## 3. Diagram spec: the extensibility core

The model never writes SVG or code. It writes a typed JSON spec, and a fixed renderer draws it.
Every addressable element has a stable `id`, so the live model can point at it.

```ts
DiagramBase = { id, nav, head, body: string[], hint?, sources: SectionRef[],
                parts: Part[], defaultPart?, caveat? }      // caveat e.g. "Curve shapes are schematic"
Part        = { id, title, note, sources: SectionRef[] }    // note shown in side panel
```

| type | covers | model supplies | harness computes |
|---|---|---|---|
| `flow` | g1, g2, g4, most architecture/method figures | nodes (id,label,sub,role), edges, groups, direction, optional `detail` sub-flow per node | elkjs layout, routing, arrowheads |
| `pipeline` | g2-style step strip + detail frame | ordered steps, phase spans, per-step `detail` (a nested flow/matrix/compare) | strip geometry |
| `chart` | g3 | axes labels, 1–3 series as control points or named shapes (`rise`, `peak-then-fall`, `saturate`…), annotations, `states[]` keyed by x for linked panel; `schematic: true` unless numbers cite a table | curve interpolation, scrub hit-area |
| `matrix` | Gram / similarity / attention grids | size, generator preset (`block`, `diag`, `noisy-block`, `explicit`) | cells |
| `compare` | c0 table, before/after | columns, rows with optional `mark` | rows |
| `sim` | g5 toy | one of a **whitelisted** sim kinds with params (`similarity-map`, `slider-curve`, `token-grid`, `threshold`) | the sim itself (hand-written TS per kind) |
| `landscape` | g6 | related works: relation (`lineage`/`component`/`compare`/`down`), weight 1–3, carried/changed lists, link text; open directions with `from[]` | hex coordinates (relation sectors, neighbours of `from`), extrusion |
| `free` | escape hatch | primitives (rect/text/line/path/circle/badge) on 560×360 | lint only |

**Overlays** (custom diagrams) are anchor-relative, so the model never computes coordinates:
```ts
Custom  = { id, question, base: diagramId | null, nav, head, sum, steps: OverlayOp[][] , spec?: DiagramSpec }
OverlayOp = badge{target,text} | highlight{target} | note{target,text,side}
          | addNode{id,label,near,dir} | addEdge{from,to,label}
          | row{cells[],mark?} | marker{x,label} | series{points|shape,label}
```
They are drawn in the `--mark` colour on top of the base diagram in its `still` state, with the newest step faded in.

The renderer measures text with `canvas.measureText` and the real fonts, wraps labels, and reports overflow back to the lint.

**Fixture**: hand-port the DINOv3 prototype into this spec format (6 general + 4 custom +
session script). It is the renderer's visual regression test (Playwright screenshots against the
prototype) and the few-shot exemplar set for generation.

---

## 4. Ingestion (`.md` → `PaperDoc`)

- Parse with remark (+gfm, +math). Build a section tree with stable ids (`s3`, `s3.2`), paragraphs with ids,
  figure captions and image refs, tables, equations and the reference list (pulling out arXiv IDs, DOIs and titles).
- Metadata comes from front-matter if present. Otherwise the first H1 is the title and the lines under it are authors and venue.
  Mark anything uncertain in the metadata rather than guessing.
- Clean up common PDF→MD converter damage: broken hyphenation, page headers, figure markers.
- Content SHA is the cache key. Re-ingesting the same paper costs nothing.
- Optional `library.json` (papers the reader has read: id, date read, margin note). If present, the landscape
  says "papers you have read" with notes. If absent, it says "papers it cites", with no notes.

---

## 5. Generation pipeline (`gemini-3.8-flash`)

All calls use JSON mode with `responseSchema` generated from the zod schemas, low temperature
(0.2–0.4) and a per-stage thinking budget. Progress streams to the UI over SSE, and each diagram
appears as soon as it validates.

1. **Digest**: full paper → title/authors/venue/id, gist (≤2 sentences), claims with section refs,
   method steps, *the one new idea*, failure modes and limitations, results by task, related work (relation, weight,
   carried/changed, link text), open directions (flagged as the guide's), glossary.
2. **Plan**: digest → 4–7 general diagrams in reading order (what it is → how it works → what's new / why
   → try it (only if a whitelisted sim fits) → around it). For each: type, the single question it answers, parts.
3. **Specs**: one call per diagram, run in parallel. Input: digest, the cited sections only, a type-specific schema
   addendum, and 1–2 DINOv3 exemplars of that type.
4. **Validate and repair** (harness):
   zod parse → semantic checks (unique ids, edges resolve, every part has a note, every `sources` ref exists
   in the PaperDoc, charts without table citations have `schematic:true`) → layout → geometric lint
   (overlap, overflow, off-canvas, label collisions) → if errors, send them back verbatim for repair
   (max 2 rounds) → if still failing, downgrade the type (e.g. `free` → `flow`) → if still failing, drop the diagram and log it.
5. **Fact-check** (cheap flash pass): each body/note sentence is checked against its cited sections.
   Unsupported sentences are rewritten or removed.

Output: `diagrams.json`, cached by paper SHA and prompt version.

---

## 6. Live guide (`gemini-3.8-live`)

**Session config**: audio out plus input and output transcription (a text-only toggle is also available), the system instruction
(§8), tools below, sliding-window context compression and a session-resumption handle (Live sessions have length limits,
so we reconnect transparently).

**Grounding**: the system instruction carries the digest, a compact *diagram manifest* (ids, part ids, what each shows,
overlay targets) and the paper text if it fits the budget. Otherwise it carries a section index and the `read_section` tool.

**Tools** (executed in the browser by the tool executor; args validated with zod; errors go back to the model as
the function response so it can fix them):

| tool | effect |
|---|---|
| `show_diagram(id, part?, x?)` | navigate, select a part, set the scrub position |
| `start_custom(question, base?, nav, head)` | create a custom diagram, returns `custom_id` |
| `add_step(custom_id, ops[])` | append one orange overlay step |
| `draw_from_scratch(custom_id, brief)` | **non-blocking**: the harness calls flash with the brief, then validates and lays out the result; the result is delivered back to the model when ready |
| `read_section(section_id)` | retrieval for long papers |
| `finish_custom(custom_id, summary)` | sets the side-panel summary; adds it to the TOC |

**Sync rule** (in the prompt and enforced by the harness): call `add_step` *before* talking about that step. Each tool call
is timestamped against the transcription stream, which gives the replay its step boundaries.
**Interruptions**: on `interrupted`, flush the playback queue and keep the diagram state.

---

## 7. Session recording and replay

- Event log: `{t, kind: you_text | guide_text | tool_call | tool_result | state}`, with times relative to session start.
  Transcription chunks are merged into lines and turns. Word timings come from chunk times (the prototype used a fixed
  0.26 s/word; we use the real ones). Guide audio can optionally be stored (MediaRecorder) for replay with audio.
- The player is a port of the prototype's player (track with chapter cuts, speed, keyboard, click-a-line-to-seek,
  scroll-follow with a manual-scroll hold). It rebuilds diagram state from the log, so replay is deterministic.
- Each session's questions become a "Made for a question you asked" group in the TOC. Sessions are saved in the store.

---

## 8. System prompts (`/prompts`, versioned; the version is part of the cache key)

- `style.md`, shared by all prompts. Write for a smart reader outside the subfield. Use short declarative sentences,
  no hype words and no "novel/groundbreaking". Use one idea per diagram. Name things concretely ("an earlier checkpoint", not "θ_t").
  Separate what the paper shows from what the guide suggests. Label schematic shapes and toys. Never invent numbers.
- `digest.md`: extraction rules. Everything gets a section ref. "Not stated" is allowed and better than a guess.
- `plan.md`: how to pick diagrams. Each answers one reader question. Prefer `flow`/`pipeline`/`chart` over `free`.
  Include a `sim` only if a whitelisted kind is faithful to the mechanism. The landscape goes last.
- `spec.<type>.md`: the type's schema in prose, its limits (≤8 nodes, labels ≤28 chars, notes ≤60 words) and exemplars.
- `repair.md`: "Here is your spec and these validator errors; return the full corrected spec."
- `factcheck.md`: claim-by-claim support check against quoted sections.
- `scratch.md`: turns a live brief into a single spec.
- `live.md`: the guide's persona and voice rules (spoken, 1–3 sentences per beat, pause for questions). It also covers:
  a decision procedure (answer on an existing diagram if one fits → custom from a base → from scratch);
  the tool-call-before-speech rule; how to reference parts by id; what to do when the paper doesn't say;
  the diagram manifest and digest slots.

---

## 9. Harness

**Runtime harness** (`server/harness`): a single `callModel(stage, input)` wrapper for every model call, with
timeouts, retry with backoff on 429/5xx, a concurrency limit, and caching keyed by (model, prompt version, input hash).
Each call logs a JSONL line: stage, latency, tokens, validation outcome and repair count.
`GEMINI_MOCK=1` replays recorded responses, so UI development and CI need no key.

**Eval harness** (`npm run eval -- papers/*.md`):
- Corpus: DINOv3 plus 4–5 deliberately different papers (a theory/math-heavy paper, a systems paper, a bio/clinical paper,
  a short workshop paper, and one with messy PDF→MD conversion).
- Metrics per paper: schema-valid on first try / after repair, lint pass, citation validity,
  fact-check unsupported rate, diagram-type mix, latency and cost.
- Playwright renders every diagram to PNG and the run produces an HTML report for visual review.
- Live eval: scripted text-mode sessions (canned questions per paper) assert that tool calls validate, that overlay targets
  exist and that steps arrive before the speech about them. Recorded sessions replay deterministically as regression tests.

---

## 10. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold, config, `npm run probe` | probe passes with a real key |
| M1 | Schemas + renderer + DINOv3 fixture | fixture renders at parity with the prototype (screenshots); themes and responsive layout work |
| M2 | Ingestion + flash pipeline + validate/repair + cache + SSE | DINOv3 `.md` → valid diagrams with no hand edits |
| M3 | Live: token, audio I/O, tools, overlays, transcript | a spoken question produces a synced custom diagram |
| M4 | Recording + replay player | a recorded session replays identically |
| M5 | Eval harness + unseen papers + prompt iteration | thresholds met on the corpus (≥90% valid after repair, 0 broken citations) |
| M6 | Polish: a11y (keyboard parts, ARIA, reduced motion), errors, empty states | — |

---

## 11. Risks and open questions

- **Still unverified on `gemini-3.8-live`**: `behavior: NON_BLOCKING` function calls (needed for `draw_from_scratch`),
  context-window compression and session resumption. These are checked in M0. If non-blocking calls are unsupported,
  the fallback is to return immediately and send the finished spec as a client text turn.
- **Quality of free-form geometry** is the main quality risk, so the plan leans on typed templates and auto-layout.
- **The sim whitelist** means some papers get no "try it" diagram. That is better than an unfaithful toy.
- **"Papers you have read"** needs a reader library. Without one, the landscape falls back to citations.
- **A DINOv3 `.md` source is needed for M2**: supply one, or I convert arXiv 2508.10104's HTML.
- Defaults assumed unless you say otherwise: voice + text, Node server, Vite/React/TS, a local file store with no database or auth.

---

## 12. MVP status (2026-10-03)

Verified in this environment:
- **Probe**: key, both models, `responseJsonSchema`, non-blocking live tool calls, compression and resumption config, ephemeral tokens.
- **Pipeline on two unrelated papers** (DINOv3, DeepSeek-R1). Each produced 5 diagrams plus the map, none dropped, 0 layout issues, 0 bad citations. Each took about 90–100 s, using about 200–300k input tokens and 10–12 calls. The fact-check rewrote 3 sentences per paper.
- **Live harness against `gemini-3.8-live`** over text:
  - Zero tool errors after prompt tuning.
  - Comparison and "why" questions each get a new custom diagram on the right base, with 2 steps.
  - A from-scratch drawing ran in the background while the guide spoke.
  - Sessions were saved and replay in the UI.
- **UI**: Playwright screenshots of every diagram type, pipeline steps, the phone layout and session replay. 13 unit tests pass.

Not verified here:
- **Browser-to-Gemini live audio.** The browser path uses the same executor and config as the verified Node harness, but headless Chromium in this container cannot reach Gemini without disabling TLS verification. Microphone capture and audio playback still need a run in a real browser.

Changes from the plan:
- The type set is final for the MVP: `flow`, `pipeline`, `chart`, `matrix`, `compare`, `sim` (similarity map only), `landscape` (built from the digest with no model call), and `free`.
- Gemini rejects `minItems`/`maxItems` on arrays of objects with a generic 400. The harness strips them from the JSON Schema, and zod plus the repair loop still enforce them.
- No `library.json` yet. The map shows the papers the paper cites, not the papers the reader has read.

Next:
- Run live sessions in a real browser and tune the voice prompt from them.
- Grow the eval corpus to 5–6 papers (theory, systems, bio, a messy PDF conversion).
- Context caching for the paper text across the spec calls.
- More sim kinds.
- A reading library for the map.

### Live guide tuning (follow-up)

Reported problems: the guide worked badly and heard its own voice. What was found and fixed:
- **Echo.** The mic streamed all the time, and Web Audio playback is not a reliable echo-cancellation reference, so the guide transcribed and answered its own speech. That caused about 21 self-interruptions in 7 questions in simulation.
  - Fix: `shared/duplex.ts`, an echo gate that is half-duplex with reference-based barge-in.
  - Stop / Esc to interrupt, and a Headphones toggle.
  - Low start-of-speech sensitivity on the server. On its own this barely helped; the gate is the fix.
- **Prompt.** The old prompt contradicted itself (stop after 1–3 sentences versus go through all beats), had no voice rules and leaked section ids. It was rewritten voice-first. The old version is kept in `eval/baselines/live.v1.md` for A/B tests.
- **Tool loop.** Every tool response made the model speak again, and it repeated itself.
  - Screen tools are now non-blocking. Results are delivered silently once the guide has spoken, or wake it only if it has not answered.
  - The executor forgives cosmetic slips.
  - `custom_id` is optional.
- **Harness.** `eval/live.ts` now has a flash judge and a `--voice` mode: TTS questions streamed in real time with the guide's own audio mixed back in at a chosen echo gain.

Results (judge scores 1–5, 7 questions):

| Run | Answered | Faithful | Spoken | Screen | Self-interruptions |
|---|---|---|---|---|---|
| Old prompt, voice, echo 0.5, no gate | 1.86 | 3.14 | 1.0 | 2.57 | 21 |
| Final, voice, DINOv3, echo 0.6 | 4.86 | 5 | 4.86 | 4.29 | 1 (the deliberate barge-in) |
| Final, voice, DeepSeek-R1, echo 0.6 | 4.71 | 5 | 4.86 | 4.14 | 1 (the deliberate barge-in) |
| Final, text, DINOv3 / DeepSeek-R1 | 4.86 / 4.86 | 5 / 5 | 4.29 / 5 | 4.71 / 3.71 | – |

Open issues:
- **Barge-in on loud speakers** needs the reader to be clearly louder than the echo; Stop / Esc covers the rest.
- **Handling interruptions:** the guide sometimes answers both the interrupted and the new question.
- **Occasional sign-off filler.**
- **Screen use on unseen papers** sometimes picks a neighbouring diagram.
- **Variance between runs is high**, so compare several runs before changing the prompt.
