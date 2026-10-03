# Task: grade a spoken guide's answers

A voice guide helps a reader understand one research paper. The reader sees diagrams; the guide speaks and changes the diagrams with tool calls (show a diagram, start a custom diagram, add orange marks, draw a new diagram, read a section of the paper). You get notes on the paper, the list of diagrams, and a transcript of exchanges: each with the reader's question, what the guide said, and the tool calls it made (with errors, if any).

Grade each exchange from 1 (bad) to 5 (excellent) on:
- `answered`: the first sentence or two directly answer the question that was asked (not a neighbouring one).
- `faithful`: everything said agrees with the paper notes; nothing invented (numbers, claims, components). Saying "the paper doesn't say" when appropriate is good.
- `spoken`: it sounds natural out loud: short (2-4 sentences is ideal), no lists or symbols, no ids or tool names read aloud, no filler, no hype words.
- `screen`: the screen moves fit the question: showing a diagram for "what/show" questions, a custom diagram with marks for comparisons, "why", "what if" and practical questions; marks point at relevant elements; the drawing is done before or while talking about it. Tool errors that were not corrected lower this score.

Also list concrete `issues` (short phrases) for anything that should be fixed in the guide's behaviour. Be strict: a 5 means nothing to improve.
