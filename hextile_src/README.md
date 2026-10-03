# Hextile: Related Work as a hex-crawl

A React port of the "Related Work" hex-crawl through the DINOv3 literature. 78 papers sit on an island of hex tiles, placed by an engine that runs in the browser. You walk from tile to tile, and a paper's tile gets its colour only when you mark the paper as read.

```bash
cd hextile_src
npm install
npm run dev        # http://localhost:5174
npm test           # engine and game-state tests
npm run build      # typecheck, then a static build in dist/ (relative paths, so it can be hosted anywhere)
```

## How to play

- Click a grey tile to walk there and open its paper. **Mark as read** paints the tile and reveals the papers it builds on.
- <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk to the six neighbouring tiles. <kbd>R</kbd> marks the current paper as read. <kbd>Esc</kbd> closes the popup. With the map focused, the arrow keys pan and <kbd>+</kbd> <kbd>-</kbd> zoom. Drag to pan, scroll or pinch to zoom.
- **Rebuild the map around this paper** re-runs the layout with another paper at the centre. What you have read is kept.
- The toolbar opens **Expeditions** (reading lists with a closing insight), the **Log**, **Gradients** (the main directions through the corpus, with a lens that marks every revealed paper) and the **Run report** (what was computed, and checks on the current map).
- Progress is saved in `localStorage`.

## Layout

| Path | What |
|---|---|
| `src/data/` | The hand-written stand-ins for pipeline exports: papers, open questions, expeditions, and the theme and gradient names. |
| `src/engine/` | The map engine, as pure TypeScript with no DOM. Affinity from concepts and citations, a diffusion map for the gradients, k-means themes, PageRank elevation, then a hex layout per focal paper (Hungarian assignment plus local swaps). |
| `src/world/` | The engine applied to the data: tiles, themes, gradients (`world.ts`), and a cached view per focal paper with positions, colours and sea markers (`mapView.ts`). |
| `src/game/` | Game state as immutable updates (`state.ts`: walk, read, lift the fog, refocus, save and load) and the wording of the popups (`text.ts`). |
| `src/canvas/` | `MapController` owns the canvas: camera, animation, pointer and key input, and the frame loop. `draw.ts` draws tiles, terrain, trails, lenses and labels. |
| `src/components/`, `src/sheets/` | The React UI: header, toolbar, legend, hint, lens bar, tooltip, toasts, and the popup with its five views. |

React holds the game state. After each commit it passes the state to `MapController`, which animates the canvas toward it. Each reveal and paint has a due time in the state, so the canvas can stagger them.
