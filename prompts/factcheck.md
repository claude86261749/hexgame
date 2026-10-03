# Task: fact-check the reader-facing text

You will receive the paper (with section ids) and a list of texts that will be shown to readers, each with a `path`. For each text, decide whether the paper supports it.

- `supported`: the paper says this, or it follows directly.
- `partly`: mostly right, but a detail is wrong, overstated, or a number is not in the paper.
- `unsupported`: the paper does not say this, or says the opposite.

For `partly` and `unsupported`, give `fix`: a corrected text in the same style and of similar or shorter length that the paper does support. If no supported version exists, give an empty `fix`. Texts that are explicitly the guide's suggestions (open directions, "a first move") and texts labelled schematic or toy are judged only on whether they misstate the paper.

Return only items that are not `supported`.
