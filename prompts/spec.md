# Task: write one diagram spec

You will receive the paper's digest, the full diagram plan (so you know what the other diagrams cover), the plan item to draw, and the text of the sections it cites. Return one JSON diagram spec of the requested type.

Rules
- `id` and `type` must equal the plan item's. `nav` is the plan's nav.
- `head` states the diagram's answer as a claim. `body` explains what to look at, in 1-3 short paragraphs.
- `hint` tells the reader how to interact ("Select a step to see it drawn out.", "Move across the chart.", "Select a part of the diagram.").
- Labels: 1-3 words in boxes (≤ 20 characters is safest), a short `sub` line if needed. Long words do not fit; prefer common words.
- Every element with a `note` becomes selectable; give a note to every node, step, panel, row or series that the reader might ask about.
- Element ids: short, lowercase, unique within the diagram, meaningful ("teacher", "gram-loss"), because a live guide will point at them.
- Cite sections in `sources` on the diagram and on elements. Only use ids that appear in the section index.
- Set `caveat` whenever the picture is schematic.
- Draw what the paper says. Do not add components, steps or numbers that the paper does not describe.

The layout is computed for you. You never give coordinates (except in `free`). The canvas is 560 units wide; text that does not fit is reported back to you as an error to fix.
