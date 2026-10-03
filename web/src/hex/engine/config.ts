/** Knobs of the map engine. */
export const CFG = {
  /** Weight of concept overlap in the affinity. */
  wConcept: 0.6,
  /** Weight of citations in the affinity. */
  wCite: 0.4,
  /** Neighbours each paper keeps in the sparse graph. */
  knn: 8,
  /** All-pairs glue that keeps the graph connected. */
  glue: 0.04,
  /** Diffusion time. */
  diffT: 2,
  /** Gradients (diffusion components) kept. */
  comps: 8,
  /** Themes asked of k-means. */
  themes: 10,
  /** How far bearings are pulled toward an even spread. */
  spread: 0.15,
  /** Cells available per paper. */
  slack: 1.1,
};
