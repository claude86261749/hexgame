// Live-guide harness: drives gemini-3.8-live with scripted questions over text, executes tools with the
// same executor as the browser, checks behaviour, and saves the run as a replayable session.
// npm run eval:live -- <paperId> ["question" ...]
import { GoogleGenAI, Modality, FunctionResponseScheduling } from '@google/genai';
import { randomUUID } from 'node:crypto';
import type { Diagram, Digest, PaperDoc, SessionEvent, SessionLog } from '../shared/schema.ts';
import { MODELS } from '../shared/config.ts';
import { emptyGuide } from '../shared/session.ts';
import { execTool, stateHolder } from '../shared/executor.ts';
import { apiKey } from '../server/gemini.ts';
import { liveConfig } from '../server/live.ts';
import { drawScratch } from '../server/scratch.ts';
import * as store from '../server/store.ts';

const [paperId, ...qs] = process.argv.slice(2);
const doc = store.get<PaperDoc>(paperId, 'doc.json')!, digest = store.get<Digest>(paperId, 'digest.json')!, diagrams = store.get<Diagram[]>(paperId, 'diagrams.json')!;
if (!doc || !digest || !diagrams) { console.error('paper not ready:', paperId); process.exit(1); }
const rel = digest.related.find(r => r.relation === 'lineage') || digest.related[0];
const questions = qs.length ? qs : [
  'What is the one new idea in this paper, in plain words?',
  rel ? `How is it different from ${rel.label}?` : 'What did they change compared with earlier work?',
  'Can you draw what someone would need to change in their own code or setup to use this?',
];

const t0 = performance.now(), now = () => (performance.now() - t0) / 1000;
const events: SessionEvent[] = [];
const st = stateHolder(emptyGuide());
let nCustom = 0, audioBytes = 0;
const record = (name: string, args: any, result: any) => { events.push({ t: now(), kind: 'tool', name, args, result }); st.apply(name, args, result); };
const ai = new GoogleGenAI({ apiKey: apiKey() });
let resolveTurn: (() => void) | null = null, pendingTools = 0, bg = 0;
const session = await ai.live.connect({
  model: MODELS.live, config: { ...liveConfig(doc, digest, diagrams) as any, responseModalities: [Modality.AUDIO] },
  callbacks: {
    onmessage: async m => {
      const sc = m.serverContent;
      if (sc?.outputTranscription?.text) events.push({ t: now(), kind: 'guide', text: sc.outputTranscription.text });
      for (const p of sc?.modelTurn?.parts || []) if (p.inlineData?.data) audioBytes += p.inlineData.data.length * 0.75;
      if (sc?.turnComplete) { events.push({ t: now(), kind: 'turn' }); if (!pendingTools && !bg) { resolveTurn?.(); } }
      for (const f of m.toolCall?.functionCalls || []) {
        pendingTools++; if (f.name === 'draw_from_scratch') bg++;
        const r = await execTool({ diagrams, state: st.get, record, nextCustomId: () => `c${++nCustom}`,
          scratch: a => drawScratch(paperId, a),
          section: async id => { const s = doc.sections.find(x => x.id === id); if (!s) throw new Error(`no section ${id}`); return { id, title: s.title, text: s.text.slice(0, 14000) }; },
        }, f.name!, f.args || {});
        session.sendToolResponse({ functionResponses: [{ id: f.id, name: f.name, response: r.response, ...(r.background ? { scheduling: FunctionResponseScheduling.WHEN_IDLE } : {}) }] });
        pendingTools--; if (f.name === 'draw_from_scratch') bg--;
      }
    },
    onerror: e => console.error('live error', (e as any)?.message || e),
    onclose: e => { if (e.code !== 1000) console.error('closed', e.code, e.reason); },
  },
});
// a turn is "done" when the model finished speaking and no tool (incl. background drawing) is outstanding; allow follow-up turns
const waitTurns = async (maxMs: number) => {
  const end = Date.now() + maxMs;
  let quiet = 0;
  while (Date.now() < end) {
    await new Promise<void>(r => { resolveTurn = r; setTimeout(r, 4000); });
    const last = events[events.length - 1];
    if (!pendingTools && !bg && last && now() - last.t > 3.5) { if (++quiet >= 1) return; } else quiet = 0;
  }
};
session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '(The reader has opened the guide. The first diagram is on screen.)' }] }], turnComplete: true });
await waitTurns(30000);
const report: any[] = [];
for (const q of questions) {
  const from = events.length, tq = now();
  events.push({ t: tq, kind: 'you', text: q });
  session.sendRealtimeInput({ text: q });
  await waitTurns(120000);
  const evs = events.slice(from);
  const tools = evs.filter(e => e.kind === 'tool') as any[];
  const firstSpeech = evs.find(e => e.kind === 'guide')?.t, firstDraw = tools.find(t => ['add_step', 'show_diagram', 'start_custom'].includes(t.name) && !t.result?.error)?.t;
  report.push({ q, secs: +(now() - tq).toFixed(1), tools: tools.map(t => t.name + (t.result?.error ? '✗' : '')).join(' '),
    errors: tools.filter(t => t.result?.error).map(t => `${t.name}: ${String(t.result.error).slice(0, 120)}`),
    drewBeforeSpeaking: firstDraw != null && (firstSpeech == null || firstDraw <= firstSpeech + 1.5),
    words: evs.filter(e => e.kind === 'guide').map((e: any) => e.text).join('').split(/\s+/).length,
    said: evs.filter(e => e.kind === 'guide').map((e: any) => e.text).join('').slice(0, 300) });
}
session.close();
const log: SessionLog = { id: 'eval-' + randomUUID().slice(0, 8), paperId, startedAt: new Date().toISOString(), duration: now(), events, customs: st.get().customs, title: 'Scripted eval session' };
store.put(paperId, `sessions/${log.id}.json`, log);
console.log(JSON.stringify(report, null, 1));
console.log(`customs: ${st.get().customs.map(c => `${c.id} "${c.nav}" base=${c.base} steps=${c.steps.length} spec=${!!c.spec} summary=${!!c.summary}`).join('\n         ')}`);
console.log(`session saved as ${log.id} (${log.duration.toFixed(0)} s, ~${(audioBytes / 48000).toFixed(0)} s of audio)`);
process.exit(0);
