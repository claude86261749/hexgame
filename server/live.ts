// Live guide setup: ephemeral token + session config (system instruction and tools) built server-side,
// so the API key never reaches the browser and the prompt stays under server control.
import { MODELS } from '../shared/config.ts';
import type { Diagram, Digest, PaperDoc } from '../shared/schema.ts';
import { layout, partsOf } from '../shared/layout.ts';
import { TOOL_DECLS } from '../shared/tools.ts';
import { ai } from './gemini.ts';
import { prompt } from './prompts.ts';
import { sectionIndex } from './ingest.ts';

export function manifest(ds: Diagram[]): string {
  return ds.map(d => {
    const parts = partsOf(d);
    const L = layout(d);
    const targets = Object.keys(L.anchors).filter(k => !k.startsWith('_'));
    const lines = [`- ${d.id} [${d.type}] "${d.nav}": ${d.head}`];
    if (d.type === 'pipeline') lines.push(`  steps: ${d.steps.map(s => `${s.id} (${s.title})`).join('; ')}`);
    else if (parts.length) lines.push(`  parts: ${parts.map(p => `${p.id} (${p.title})`).join('; ')}`);
    if (d.type === 'chart') lines.push(`  curves: ${d.series.map(s => `${s.id}=${s.label} [${s.shape}]`).join('; ')}; x axis: ${d.xLabel}`);
    if (d.type === 'compare') lines.push(`  columns: ${d.columns.join(' | ')}; rows: ${d.rows.map(r => `${r.id} (${r.label}: ${r.cells.join(' / ')})`).join('; ')}`);
    lines.push(`  overlay targets: ${targets.join(', ')}`);
    return lines.join('\n');
  }).join('\n');
}

const digestText = (g: Digest) => [
  `${g.title}. ${g.byline}. Field: ${g.field}.`, g.gist, `Problem: ${g.problem.text}`, `New idea: ${g.newIdea.text}`,
  `Claims:\n${g.claims.map(c => `- ${c.text} [${c.sources.join(',')}]`).join('\n')}`,
  `Method:\n${g.method.map(m => `- ${m.step}: ${m.detail}`).join('\n')}`,
  `Findings:\n${g.findings.map(c => `- ${c.text} [${c.sources.join(',')}]`).join('\n')}`,
  `Limitations:\n${g.limitations.map(c => `- ${c.text}`).join('\n')}`,
  `Related work:\n${g.related.map(r => `- ${r.label} (${r.year}, ${r.relation}): ${r.link}`).join('\n')}`,
  `Open directions (the guide's suggestions, not the authors'):\n${g.openDirections.map(o => `- ${o.title}: ${o.open}`).join('\n')}`,
  `Glossary:\n${g.glossary.map(x => `- ${x.term}: ${x.plain}`).join('\n')}`,
].join('\n\n');

export function liveConfig(doc: PaperDoc, digest: Digest, diagrams: Diagram[]) {
  const systemInstruction = prompt('live', {
    title: digest.title, byline: digest.byline, digest: digestText(digest), manifest: manifest(diagrams),
    sections: sectionIndex(doc), firstNav: diagrams[0]?.nav || '',
  });
  return {
    systemInstruction, tools: [{ functionDeclarations: TOOL_DECLS }],
    contextWindowCompression: { slidingWindow: {} }, sessionResumption: {},
    outputAudioTranscription: {}, inputAudioTranscription: {},
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.LIVE_VOICE || 'Kore' } } },
  };
}

export async function mintToken(): Promise<string> {
  const t = await ai().authTokens.create({ config: {
    uses: 1, expireTime: new Date(Date.now() + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60e3).toISOString(),
    liveConnectConstraints: { model: MODELS.live }, httpOptions: { apiVersion: 'v1alpha' } } });
  return t.name!;
}
