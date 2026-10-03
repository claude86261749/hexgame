// Live guide setup: ephemeral token + session config (system instruction and tools) built server-side,
// so the API key never reaches the browser and the prompt stays under server control.
import { MODELS } from '../shared/config.ts';
import type { Diagram, Digest, PaperDoc } from '../shared/schema.ts';
import { layout, partsOf } from '../shared/layout.ts';
import { toolDecls } from '../shared/tools.ts';
import { ai } from './gemini.ts';
import { prompt, fill } from './prompts.ts';
import { StartSensitivity, EndSensitivity } from '@google/genai';

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
  `Claims:\n${g.claims.map(c => `- ${c.text}`).join('\n')}`,
  `Method:\n${g.method.map(m => `- ${m.step}: ${m.detail}`).join('\n')}`,
  `Findings:\n${g.findings.map(c => `- ${c.text}`).join('\n')}`,
  `Limitations:\n${g.limitations.map(c => `- ${c.text}`).join('\n')}`,
  `Related work:\n${g.related.map(r => `- ${r.label} (${r.year}, ${r.relation}): ${r.link}`).join('\n')}`,
  `Open directions (the guide's suggestions, not the authors'):\n${g.openDirections.map(o => `- ${o.title}: ${o.open}`).join('\n')}`,
  `Glossary:\n${g.glossary.map(x => `- ${x.term}: ${x.plain}`).join('\n')}`,
].join('\n\n');

/** Compact section list for read_section: numbered sections up to depth 3, no references. */
const liveSections = (doc: PaperDoc) => doc.sections
  .filter(s => /^(abstract|s[0-9A-Z]+(\.\d+){0,2})$/.test(s.id) && s.text.length > 200)
  .map(s => `${s.id}: ${s.title.replace(/^[A-Z0-9.]+\s+/, '')}`).join('\n');

/** `template` overrides prompts/live.md (used by the eval harness for A/B runs). */
export function liveConfig(doc: PaperDoc, digest: Digest, diagrams: Diagram[], opts: { template?: string; nonBlocking?: boolean } = {}) {
  const slots = { title: digest.title, byline: digest.byline, digest: digestText(digest), manifest: manifest(diagrams), sections: liveSections(doc), firstNav: diagrams[0]?.nav || '' };
  const systemInstruction = opts.template ? fill(opts.template, slots, 'live') : prompt('live', slots);
  return {
    systemInstruction, tools: [{ functionDeclarations: toolDecls({ nonBlocking: opts.nonBlocking ?? process.env.LIVE_NONBLOCKING !== '0' }) }],
    contextWindowCompression: { slidingWindow: {} }, sessionResumption: {},
    outputAudioTranscription: {}, inputAudioTranscription: {},
    // Gemini Live defaults to high start sensitivity, which fires on speaker echo and room noise.
    realtimeInputConfig: { automaticActivityDetection: {
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW, endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      prefixPaddingMs: 120, silenceDurationMs: 700 } },
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.LIVE_VOICE || 'Kore' } } },
  };
}

export async function mintToken(): Promise<string> {
  const t = await ai().authTokens.create({ config: {
    uses: 1, expireTime: new Date(Date.now() + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60e3).toISOString(),
    liveConnectConstraints: { model: MODELS.live }, httpOptions: { apiVersion: 'v1alpha' } } });
  return t.name!;
}
