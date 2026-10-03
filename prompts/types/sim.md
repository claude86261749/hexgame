## Type: sim (similarity-map)

A toy 8×8 image with 4 regions. The reader picks a cell; each mode shows how similar every other cell is to it, plus a contrast bar (similarity inside the region minus outside). Modes differ by `coherence` (0 = similarity ignores regions, 1 = similarity follows regions exactly) and `noise` (0-1). Use it only when the paper's mechanism is about how local units (patches, tokens, pixels) group by similarity. Name the regions after a plausible scene, and `unit` after the paper's unit. Always include the toy disclaimer in `caveat`.

Example:
```json
{"id":"g5","type":"sim","nav":"Try the fix","head":"Try it on a toy image",
 "body":["Pick a patch. Each map shows how similar every other patch is to it.","Late in training with no anchoring, similarity leaks across regions. With Gram anchoring the pattern is clean again."],
 "hint":"Hover or tap a patch to move the reference.","caveat":"A toy simulation for intuition, not data from the paper.","sources":["s4.1","s4.2"],
 "kind":"similarity-map","regions":["sky","dog","tree","grass"],"unit":"patch",
 "modes":[{"label":"Early checkpoint","coherence":0.85,"noise":0.15,"accent":true},{"label":"Late, no anchor","coherence":0.25,"noise":0.6},{"label":"Late, anchored","coherence":0.95,"noise":0.08,"accent":true}]}
```
