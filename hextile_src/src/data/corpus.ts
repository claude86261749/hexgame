import data from './corpus.json';
import type { Corpus } from './types';

/* Built by scripts/hexcorpus.ts in the parent project from a directory of arXiv papers in Markdown:
   summaries, concepts and citation classes are extracted by a model from each paper; names are written after the computation. */
export const CORPUS = data as unknown as Corpus;
export const { meta: META, papers: PAPERS, themes: THEME_DEFS, grads: GRAD_DEFS, expeditions: EXPEDITIONS, open: OPEN } = CORPUS;

/** Where the diagram explainer lives, relative to the map. Set VITE_EXPLAINER to override. */
export const EXPLAINER = (import.meta.env.VITE_EXPLAINER as string | undefined) ?? '../';
export const explainerUrl = (arxiv: string) => `${EXPLAINER}#/arxiv/${arxiv}`;
