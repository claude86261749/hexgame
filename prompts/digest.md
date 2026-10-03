# Task: digest the paper

You will receive a research paper as Markdown. Each section starts with its id in square brackets, e.g. `[s4.2] ### 4.2 Gram Anchoring Objective`. The reference list comes last.

Produce a structured digest that later steps use to plan diagrams and to brief a live guide. Every field is read by people, so the house style applies.

Fields
- `title`, `shortTitle` (the name people use for the method or model), `byline` ("First-author surname, second, third and colleagues, Institution, Year" — take institutions and year from the paper; omit what is not stated), `arxiv` if given, `field` (2-4 words).
- `gist`: two sentences. What the paper produces and why someone would care.
- `problem`: the problem it addresses, as the paper frames it.
- `newIdea`: the single most important new idea. If the paper is mostly a scale-up of earlier work, say that and name the one genuinely new piece.
- `claims`: the main claims, each with sources.
- `method`: the method as an ordered list of steps (label of 1-3 words + a plain explanation).
- `findings`: results that matter, with numbers only as the paper states them.
- `limitations`: what the authors concede or what the evidence does not cover.
- `related`: up to 10 earlier or concurrent works that the reader needs to place this paper, chosen from the papers it builds on, reuses, compares against, or that consume its output. For each:
  - `id` (short lowercase), `label` (the name people use, 1-3 words), `year`, full `title`, short `authors`, `venue` if known, `arxiv` id if it appears in the references.
  - `relation`: lineage | component | compare | downstream.
  - `weight` 1-3: how much this paper leans on it.
  - `link`: 2-3 sentences on how the two connect.
  - `carriedHeading` / `carried`: e.g. "Carried into DINOv3" + what was kept; for comparisons "Where they agree".
  - `changedHeading` / `changed`: e.g. "Changed" + what is different; for comparisons "Where they differ".
  Only include works the paper actually discusses or uses. Prefer variety across the four relations.
- `openDirections`: 3-5 questions the paper leaves open. These are the guide's suggestions, not the authors' claims: `shows` (what the paper shows), `open` (what it leaves open), `move` (a concrete first experiment), and `from` (ids from `related` to approach it from; at least one).
- `glossary`: terms a non-specialist will trip on, with a plain gloss.

Use "not stated" rather than guessing. Cite section ids in every `sources` list; never cite ids that do not exist.
