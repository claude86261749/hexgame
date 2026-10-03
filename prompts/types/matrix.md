## Type: matrix

1-3 small heat-map grids side by side (size 4-12). Presets: `diagonal` (only self-similarity), `blocks` (clean groups; set `blocks` 2-4), `noisy-blocks` (groups blurred by noise), `noise` (no structure), `explicit` (give a size×size `values` array in 0..1, only when the paper gives one). `links` draw a labelled two-way arrow between two panels ("pulled together", "compared"). Use `accent: true` on the target or good panel.

Example (another paper; copy the form, not the content):
```json
{"id":"g4","type":"matrix","nav":"The fix","head":"Pin the pattern, not the features",
 "body":["Take an early checkpoint whose patch features are still clean. Compare how patches relate to one another in the current model and in that checkpoint, and pull the two patterns together."],
 "hint":"Select a grid.","sources":["s4.2"],
 "panels":[{"id":"current","label":"The model now","size":8,"preset":"noisy-blocks","note":"Its Gram matrix: every patch compared with every other.","sources":["s4.2"]},
  {"id":"teacher","label":"Gram teacher","size":8,"preset":"blocks","accent":true,"note":"An earlier checkpoint from the same run, taken while patch features are clean.","sources":["s4.2"]}],
 "links":[{"from":"current","to":"teacher","label":"pulled together"}]}
```
