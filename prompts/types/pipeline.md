## Type: pipeline

An ordered strip of 2-7 steps. Strip labels are 1-2 short words (≤ 12 characters each word). Each step has a `title`, a `note`, and ideally a `detail` drawn in a frame below the strip when the step is selected:
- `{"kind":"flow", ...}`: a small flow (≤ 6 nodes, LR with ≤ 3 layers, or TB).
- `{"kind":"compare", ...}`: a small table.
- `{"kind":"matrix", ...}`: 1-2 grids.
- `{"kind":"bullets","items":[...]}`: 2-5 short lines, when nothing drawable fits.
Detail element ids must be unique across the whole diagram. `phases` underline runs of steps ("main training run", "shorter passes afterwards").

Example (another paper; copy the form, not the content):
```json
{"id":"g2","type":"pipeline","nav":"How it is trained","head":"Six steps, no labels",
 "body":["Training is self-supervised: the model learns by agreeing with itself across views of the same image.","Steps 1 and 2 are the main run. The rest are shorter passes afterwards."],
 "hint":"Select a step to see it drawn out.","sources":["s3","s4","s5"],
 "steps":[
  {"id":"curate","label":"Curate","title":"Curate the data","note":"Start from about 17B web images and keep a balanced subset of about 1.7B.","sources":["s3.1"],
   "detail":{"kind":"flow","direction":"LR","nodes":[{"id":"web","label":"About 17B","sub":"web images","kind":"input"},{"id":"cluster","label":"Balance","sub":"by clustering"},{"id":"kept","label":"About 1.7B","sub":"images kept","kind":"accent"}],"edges":[{"from":"web","to":"cluster"},{"from":"cluster","to":"kept"}]}},
  {"id":"pretrain","label":"Pretrain","title":"Pretrain the 7B model","note":"A student sees some crops; a slow-moving copy, the teacher, sees others. The student learns to agree with it.","sources":["s3.2"],
   "detail":{"kind":"bullets","items":["DINO loss: agree on the whole image","iBOT loss: agree on each masked patch","KoLeo: spread features apart"]}},
  {"id":"anchor","label":"Anchor","title":"Gram anchoring","note":"Ties patch-to-patch similarities to those of an earlier checkpoint.","sources":["s4.2"],
   "detail":{"kind":"matrix","panels":[{"id":"now","label":"The model now","size":8,"preset":"noisy-blocks"},{"id":"early","label":"Earlier checkpoint","size":8,"preset":"blocks","accent":true}],"links":[{"from":"now","to":"early","label":"pulled together"}]}}],
 "phases":[{"label":"main training run","from":"curate","to":"pretrain"},{"label":"shorter passes","from":"anchor","to":"anchor"}]}
```
