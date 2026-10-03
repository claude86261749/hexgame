# Task: plan the general diagrams

You will receive the paper's digest and its section index. Choose 4 to 6 diagrams that, read in order, explain the paper. A map of related work ("Around it") is added automatically at the end, so do not plan one.

A good sequence usually runs:
1. What it is: the object the paper produces and how it is used (often a `flow`).
2. How it works or how it is trained: the method as steps (`pipeline`, with a drawn-out `detail` for each step).
3. The problem or the observation that motivates the new idea (a `chart` of a trend, or a `matrix`).
4. The new idea itself: its mechanism (a `flow` or `matrix`).
5. Optionally, try it: a `sim` only if the toy similarity map is faithful to a mechanism in the paper (for example, patch or token similarity, clustering, attention locality). Otherwise skip it.
6. Optionally, what changed against the baseline (`compare`), if the paper is defined by its difference from a predecessor.

Adapt the sequence to the paper. A theory paper might be: setting (flow) → assumption vs result (compare) → the bound's behaviour (chart) → proof idea (pipeline). A systems paper might be: architecture (flow) → request path (pipeline) → bottleneck (chart) → design choices (compare).

Types available
- `flow`: boxes and arrows (≤10 nodes). Architectures, data flow, a mechanism with parts.
- `pipeline`: an ordered strip of 2-7 steps; each step has a detail drawing (a small flow, compare, matrix or bullets) shown when selected.
- `chart`: 1-3 schematic curves against one x axis, scrubbable; each x range has a one-sentence state. For trends, trade-offs, training dynamics, scaling.
- `matrix`: 1-3 small heat-map grids (similarity, attention, Gram, confusion) from presets.
- `compare`: a table with up to 10 rows and 1-3 value columns. Before/after, this vs baseline, settings.
- `sim`: the toy similarity map (one kind only; see above).
- `free`: hand-placed primitives. Last resort; avoid.

For each diagram give `id` (g1, g2, … in reading order), `type`, `nav` (≤34 chars, the reader's question in a few words), `question` (the one question it answers), `mustShow` (concretely what must be in it: the parts, the steps, the curves, the rows), and `sources` (the sections it will draw from).

No two diagrams should answer the same question. Prefer `flow`, `pipeline`, `chart` and `compare` over `free`.
