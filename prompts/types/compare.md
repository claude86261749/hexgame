## Type: compare

A table: a row-label column plus 1-3 value columns (`columns` are their headers). Up to 10 rows. Cells are short (≤ 30 characters). Set `mark: true` on rows that carry the point of the diagram (the genuinely new thing). Give rows a `note` when there is more to say.

Example (another paper; copy the form, not the content):
```json
{"id":"g5","type":"compare","nav":"Against DINOv2","head":"DINOv2's recipe, much larger, plus one new step",
 "body":["Most rows are scale. One row has no counterpart in DINOv2."],"hint":"Select a row.","sources":["s3","s4"],
 "columns":["DINOv2","DINOv3"],
 "rows":[{"id":"images","label":"Training images","cells":["142M","about 1.7B"],"note":"Curated from about 17B web images.","sources":["s3.1"]},
  {"id":"params","label":"Parameters","cells":["1.1B","about 6.7B"]},
  {"id":"pos","label":"Positions","cells":["learned","rotary (RoPE)"]},
  {"id":"gram","label":"Patch regulariser","cells":["none","Gram anchoring"],"mark":true,"note":"The one step with no counterpart.","sources":["s4.2"]}]}
```
