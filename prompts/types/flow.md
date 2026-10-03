## Type: flow

Boxes and arrows, laid out automatically in layers. Use `LR` (left to right) when the longest chain is at most 4 boxes; otherwise `TB`. At most 10 nodes, at most 16 edges, and at most about 3 boxes per layer for `TB`.

Node `kind`: `input` (data going in, drawn plain), `accent` (the thing the diagram is about, drawn in the accent colour), `output`, `muted` (context), `default`.
`groups` draw a labelled outline around nodes that belong together; only group nodes that sit next to each other in the layout.

Example (from another paper's guide; copy the form, not the content):
```json
{"id":"g1","type":"flow","nav":"What it is","head":"One frozen backbone, many tasks",
 "body":["DINOv3 is a vision transformer trained on images alone. It turns an image into one vector for the whole picture and one for every 16-by-16 pixel patch.","The claim is that these features can stay frozen. You train a small head for each task, or use none."],
 "hint":"Select the backbone or a task.","sources":["s1","s6"],"direction":"LR",
 "nodes":[{"id":"image","label":"Image","kind":"input","note":"Any size: rotary positions make every resolution valid.","sources":["s3.2"]},
  {"id":"backbone","label":"DINOv3","sub":"frozen, never fine-tuned","kind":"accent","note":"A vision transformer of about 6.7B parameters, plus distilled versions from 21M upward.","sources":["s3.2","s5.2"]},
  {"id":"seg","label":"Segmentation","sub":"a linear layer","note":"A single linear layer on the patch vectors already segments well.","sources":["s6.1.2"]},
  {"id":"depth","label":"Depth","sub":"a DPT-style head","note":"A depth head is trained on top while the backbone stays untouched.","sources":["s6.3.3"]},
  {"id":"track","label":"Video tracking","sub":"no head","note":"Patches are matched between frames by feature similarity.","sources":["s6.1.5"]}],
 "edges":[{"from":"image","to":"backbone"},{"from":"backbone","to":"seg"},{"from":"backbone","to":"depth"},{"from":"backbone","to":"track"}]}
```
