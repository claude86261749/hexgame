## Type: chart

1-3 curves over one x axis (x and y run 0 to 1; the reader never sees raw values unless you add ticks). Use named `shape`s: `rise`, `saturate`, `fall`, `decay`, `peak-then-fall` and `dip-then-rise` (set `peak` to the x of the turn), `s-curve` (`peak` = inflection), `flat`, or `points` with up to 12 {x,y} points when the paper gives a specific trajectory.

The reader scrubs along x; `states` say in one sentence what is true in each x range (cover 0 to 1 without gaps). `annotations` mark moments on the x axis. `xTicks` label the axis ("0", "200k", "1M").
Set `schematic: true` and a `caveat` unless every curve comes from a table you cite. Mark the curve the diagram is about with `accent: true`.

Example (another paper; copy the form, not the content):
```json
{"id":"g3","type":"chart","nav":"What breaks at scale","head":"Train longer, and patches get worse",
 "body":["Two things are measured as training goes on. Image-level quality keeps improving. Dense quality peaks early and then slides."],
 "hint":"Move across the chart.","caveat":"Curve shapes are schematic, not the paper's numbers.","sources":["s4.1"],
 "xLabel":"training iterations","schematic":true,
 "xTicks":[{"x":0,"label":"0"},{"x":0.2,"label":"200k"},{"x":1,"label":"1M"}],
 "series":[{"id":"global","label":"Image-level quality","shape":"saturate","note":"Classification accuracy keeps climbing for the whole run.","sources":["s4.1"]},
  {"id":"dense","label":"Dense quality","shape":"peak-then-fall","peak":0.2,"accent":true,"note":"Segmentation from frozen patches peaks around 200k iterations, then declines.","sources":["s4.1"]}],
 "annotations":[{"id":"peak","x":0.2,"label":"dense peak"}],
 "states":[{"from":0,"to":0.2,"text":"Patches similar to a given patch are the object it belongs to. Dense tasks work well."},
  {"from":0.2,"to":1,"text":"Similarity smears across the image. Dense tasks get worse from here on."}]}
```
