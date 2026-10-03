import type { GradDef, ThemeDef } from './types';

/* Names a model would write after seeing the computed result (the naming stage).
   Each is pinned to an anchor paper, so it follows its cluster or gradient if the numbers move. */
export const THEME_DEFS: ThemeDef[] = [
  { anchor: 'dinov2', name: 'DINOv2 Commons', terrain: 'outpost', note: 'The scaled-up recipe, its data, and the work built on the frozen model.' },
  { anchor: 'simclr', name: 'Twin-View Meadows', terrain: 'meadow', note: 'Contrastive and joint-embedding methods built on pairs of views.' },
  { anchor: 'detr', name: 'Decoder Works', terrain: 'works', note: 'Detection and segmentation decoders, and the backbones shaped for them.' },
  { anchor: 'sam', name: 'Mask Icefield', terrain: 'ice', note: 'Promptable segmentation trained on a billion masks.' },
  { anchor: 'dvitfeat', name: 'Patch Terraces', terrain: 'terrace', note: 'What the patch tokens know: correspondence, discovery, upsampling.' },
  { anchor: 'bert', name: 'Token Marshes', terrain: 'marsh', note: 'Transformers, and learning by masking tokens and reconstructing them.' },
  { anchor: 'clip', name: 'Caption Coast', terrain: 'coast', note: 'Encoders supervised by text, and the bridges back from vision-only models.' },
  { anchor: 'ijepa', name: 'Teacher Range', terrain: 'mountain', note: 'A teacher network supplies the targets: self-distillation and latent prediction.' },
  { anchor: 'dpt', name: 'Geometry Highlands', terrain: 'crystal', note: 'Depth, pointmaps and 3D read out of 2D backbones.' },
  { anchor: 'deit', name: 'ConvNet Quarry', terrain: 'quarry', note: 'Supervised training, ConvNets and distillation: the older ground the rest stands on.' },
];

export const GRAD_DEFS: GradDef[] = [
  { anchor: 'detr', at: { name: 'Transformer machinery', gloss: 'architectures and decoders' },
    away: { name: 'Reading features', gloss: 'what frozen features hold, with or without text' } },
  { anchor: 'moco', at: { name: 'Contrastive objectives', gloss: 'learning from pairs of views' },
    away: { name: 'Depth and 3D', gloss: 'geometry read out of 2D backbones' } },
  { anchor: 'lost', at: { name: 'Label-free patches', gloss: 'objects and parts from patch similarity' },
    away: { name: 'Text and mask supervision', gloss: 'labels at web scale' } },
];
