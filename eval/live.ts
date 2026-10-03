// Live-guide harness. Drives gemini-3.8-live with scripted questions, executes tools with the same executor
// as the browser, grades answers with a flash judge, and saves the run as a replayable session.
//
//   npm run eval:live -- <paperId> [--prompt file.md] [--voice [--echo 0.5] [--no-gate]] [--no-judge] [--q "question"]...
//
// --voice synthesises each question with Gemini TTS and streams it as 16 kHz mic audio in real time. The guide's own
// audio is "played" at real speed and mixed back into the mic at --echo gain (a laptop speaker), through the same
// EchoGate the browser uses (unless --no-gate). This reproduces "the guide hears itself" and measures the fix.
import { GoogleGenAI, Modality, FunctionResponseScheduling } from '@google/genai';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Diagram, Digest, PaperDoc, SessionEvent, SessionLog } from '../shared/schema.ts';
import { MODELS } from '../shared/config.ts';
import { emptyGuide, transcriptLines } from '../shared/session.ts';
import { execTool, stateHolder, settle } from '../shared/executor.ts';
import { isNonBlocking } from '../shared/tools.ts';
import { EchoGate, toPcm16, fromPcm16, resample } from '../shared/duplex.ts';
import { apiKey, ai as flash, generateJSON } from '../server/gemini.ts';
import { liveConfig, manifest } from '../server/live.ts';
import { drawScratch } from '../server/scratch.ts';
import * as store from '../server/store.ts';

/* ------------------------------------------------------------------ args */
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const paperId = argv[0];
const voice = flag('--voice'), gateOn = !flag('--no-gate'), echoGain = Number(opt('--echo') ?? (voice ? 0.5 : 0)), judge = !flag('--no-judge');
const templateFile = opt('--prompt');
const qArgs = argv.flatMap((a, i) => a === '--q' ? [argv[i + 1]] : []);
const doc = store.get<PaperDoc>(paperId, 'doc.json')!, digest = store.get<Digest>(paperId, 'digest.json')!, diagrams = store.get<Diagram[]>(paperId, 'diagrams.json')!;
if (!doc || !digest || !diagrams) { console.error('paper not ready:', paperId); process.exit(1); }

const lineage = digest.related.find(r => r.relation === 'lineage') || digest.related[0];
const questions: { text: string; interrupt?: boolean }[] = qArgs.length ? qArgs.map(text => ({ text })) : [
  { text: 'What problem is this paper trying to solve?' },
  { text: 'What is the one new idea here?' },
  { text: lineage ? `How is it different from ${lineage.label}?` : 'How is it different from earlier work?' },
  { text: 'Why did they need that?' },
  { text: 'What numbers from the results should I remember?' },
  { text: 'If I wanted to use this in my own project, what would I have to change?', interrupt: voice },
  { text: 'Does this also work for robotics?' },
];

/* ------------------------------------------------------------------ session plumbing */
const FILLER = 'Can you walk me through the training pipeline in detail?';
const t0 = performance.now(), now = () => (performance.now() - t0) / 1000;
const events: SessionEvent[] = [];
const st = stateHolder(emptyGuide());
let nCustom = 0, pendingTools = 0, lastServer = 0, interrupted = 0, guideAudioSec = 0;
const record = (name: string, args: any, result: any) => { events.push({ t: now(), kind: 'tool', name, args, result }); st.apply(name, args, result); };

// simulated loudspeaker (16 kHz) and microphone
let playback: Float32Array = new Float32Array(0);
const appendPlayback = (f: Float32Array) => { const n = new Float32Array(playback.length + f.length); n.set(playback); n.set(f, playback.length); playback = n; };
let falseBarges = 0;
let dropTurn = false, guideRms = 0.1, lastSpeech = -1;
const gate = new EchoGate(f => sendMic(f), () => { dropTurn = true; if (!speech.length) falseBarges++; events.push({ t: now(), kind: 'tool', name: 'barge', args: { readerSpeaking: speech.length > 0 }, result: {} }); playback = new Float32Array(0); }, { enabled: gateOn });
let micBatch: Float32Array[] = [];
const sendMic = (f: Float32Array) => {
  micBatch.push(f);
  if (micBatch.length >= 5) { const all = new Float32Array(micBatch.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of micBatch) { all.set(b, o); o += b.length; } micBatch = []; session.sendRealtimeInput({ audio: { data: Buffer.from(toPcm16(all)).toString('base64'), mimeType: 'audio/pcm;rate=16000' } }); }
};

const cfg: any = liveConfig(doc, digest, diagrams, { template: templateFile ? readFileSync(templateFile, 'utf8') : undefined, nonBlocking: !flag('--blocking') });
const decls = cfg.tools[0].functionDeclarations;
if (flag('--default-vad')) delete cfg.realtimeInputConfig;
if (opt('--vad')) cfg.realtimeInputConfig = JSON.parse(opt('--vad')!); // Gemini Live's defaults (high start sensitivity), as before the fix
const session = await new GoogleGenAI({ apiKey: apiKey() }).live.connect({
  model: MODELS.live, config: { ...cfg as any, responseModalities: [Modality.AUDIO] },
  callbacks: {
    onmessage: async m => {
      lastServer = now();
      const sc = m.serverContent;
      if (sc?.inputTranscription?.text) events.push({ t: now(), kind: 'you', text: sc.inputTranscription.text });
      if (sc?.interrupted || sc?.turnComplete) dropTurn = false;
      if (sc?.outputTranscription?.text) lastSpeech = now();
      if (sc?.outputTranscription?.text && !dropTurn) events.push({ t: now(), kind: 'guide', text: sc.outputTranscription.text });
      for (const p of sc?.modelTurn?.parts || []) if (p.inlineData?.data && !dropTurn) {
        const pcm = fromPcm16(new Uint8Array(Buffer.from(p.inlineData.data, 'base64')));
        { let e = 0; for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i]; const r = Math.sqrt(e / Math.max(1, pcm.length)); if (r > 0.02) guideRms = guideRms * 0.9 + r * 0.1; }
        guideAudioSec += pcm.length / 24000;
        if (voice) appendPlayback(resample(pcm, 24000, 16000));
      }
      if (sc?.interrupted) { interrupted++; events.push({ t: now(), kind: 'tool', name: 'interrupted', args: {}, result: { error: 'server interrupted the guide' } }); playback = new Float32Array(0); }
      if (sc?.turnComplete) events.push({ t: now(), kind: 'turn' });
      if (sc?.turnComplete) lastKind = 'turn'; else if (sc?.modelTurn || m.toolCall) lastKind = 'model';
      for (const f of m.toolCall?.functionCalls || []) {
        pendingTools++;
        const tCall = now();
        const r = await execTool({ diagrams, state: st.get, record, nextCustomId: () => `c${++nCustom}`, scratch: a => drawScratch(paperId, a),
          section: async id => { const s = doc.sections.find(x => x.id === id); if (!s) throw new Error(`no section ${id}`); return { id, title: s.title, text: s.text.slice(0, 14000) }; },
        }, f.name!, f.args || {});
        const out = await settle(r, isNonBlocking(decls, f.name!), tCall * 1000, t => lastSpeech * 1000 > t, () => now() * 1000);
        session.sendToolResponse({ functionResponses: [{ id: f.id, name: f.name, response: out.response, ...(out.scheduling ? { scheduling: FunctionResponseScheduling[out.scheduling] } : {}) }] });
        pendingTools--; lastServer = now();
      }
    },
    onerror: e => console.error('live error', (e as any)?.message || e),
    onclose: e => { if (e.code !== 1000) console.error('closed', e.code, e.reason); },
  },
});

/* ------------------------------------------------------------------ TTS for spoken questions (cached) */
async function speak(text: string): Promise<Float32Array> {
  const dir = join(store.DATA, 'cache'); mkdirSync(dir, { recursive: true });
  const f = join(dir, 'tts2-' + createHash('sha256').update(text).digest('hex').slice(0, 16) + '.wav');
  let wav: Buffer;
  if (existsSync(f)) wav = readFileSync(f);
  else {
    const r = await flash().models.generateContent({ model: 'gemini-3.8-flash-tts', contents: text,
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } } });
    wav = Buffer.from(r.candidates![0].content!.parts![0].inlineData!.data!, 'base64'); writeFileSync(f, wav);
  }
  const rate = wav.readUInt32LE(24); let off = 12;
  while (off < wav.length - 8 && wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const data = wav.subarray(off + 8, off + 8 + wav.readUInt32LE(off + 4));
  return resample(fromPcm16(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), rate, 16000);
}

/* ------------------------------------------------------------------ driving the conversation */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastKind = '';
let askedAt = 0;
const idle = () => pendingTools === 0 && playback.length === 0 && lastKind === 'turn' && now() - lastServer > 2 && (lastSpeech > askedAt || now() - askedAt > 10);
async function waitIdle(maxS: number) { const end = now() + maxS; while (now() < end && !idle()) await sleep(200); }

// real-time mic loop (voice mode): 20 ms frames of speech + echo + a little noise
let speech: Float32Array = new Float32Array(0);
let micTimer: NodeJS.Timeout | undefined;
if (voice) {
  let tPrev = performance.now(), carry = 0;
  micTimer = setInterval(() => {
    const tNow = performance.now(); carry += tNow - tPrev; tPrev = tNow;
    while (carry >= 20) {
      carry -= 20;
      const f = new Float32Array(320);
      const echo = playback.subarray(0, 320); playback = playback.subarray(echo.length);
      let ref = 0; for (let i = 0; i < echo.length; i++) ref += echo[i] * echo[i]; ref = Math.sqrt(ref / 320);
      for (let i = 0; i < 320; i++) f[i] = (speech[i] ?? 0) + (echo[i] ?? 0) * echoGain + (Math.random() - 0.5) * 0.004;
      speech = speech.subarray(Math.min(320, speech.length));
      if (playback.length) gate.playbackUntil(tNow + playback.length / 16);
      gate.push(f, tNow, ref);
    }
  }, 10);
}

async function ask(q: { text: string; interrupt?: boolean }) {
  if (voice) {
    const audio = await speak(q.text);
    if (q.interrupt) { const end = now() + 30; while (now() < end && playback.length < 16000 * 1.5) await sleep(100); } // talk over the guide once it is mid-answer
    // the reader speaks as loud as the guide's own signal (--voice-level); echo is --echo of that
    { let e = 0, n = 0; for (let i = 0; i < audio.length; i++) if (Math.abs(audio[i]) > 0.01) { e += audio[i] * audio[i]; n++; } const k = (guideRms * Number(opt('--voice-level') ?? 1)) / Math.sqrt(e / Math.max(1, n)); for (let i = 0; i < audio.length; i++) audio[i] *= k; }
    speech = audio;
    while (speech.length) await sleep(50);
  } else {
    events.push({ t: now(), kind: 'you', text: q.text });
    session.sendRealtimeInput({ text: q.text });
  }
  lastKind = 'asked'; lastServer = now(); askedAt = now(); // idle again only after the guide has taken its turn
}

session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '(The reader has opened the guide. The first diagram is on screen.)' }] }], turnComplete: true });
await sleep(1500); await waitIdle(30);
const marks: number[] = [];
for (const [i, q] of questions.entries()) {
  marks.push(events.length);
  if (q.interrupt && i > 0) {
    // ask the previous question again in a different way so the guide is mid-answer, then interrupt it
    await ask({ text: FILLER });
    await sleep(500);
  }
  await ask(q);
  await sleep(1000); await waitIdle(75);
}
await sleep(1500);
clearInterval(micTimer); session.close();

/* ------------------------------------------------------------------ metrics */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
const grams = (w: string[], n = 3) => w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(' '));
const guideText = events.filter(e => e.kind === 'guide').map((e: any) => e.text).join('');
const heardText = events.filter(e => e.kind === 'you').map((e: any) => e.text).join(' ');
const guideGrams = new Set(grams(words(guideText)));
const heardGrams = grams(words(heardText));
const echoShare = heardGrams.length ? heardGrams.filter(g => guideGrams.has(g)).length / heardGrams.length : 0;

const exchanges = questions.map((q, i) => {
  const evs = events.slice(marks[i], marks[i + 1] ?? events.length);
  const tools = evs.filter(e => e.kind === 'tool' && !['interrupted', 'barge'].includes((e as any).name)) as any[];
  const heard = evs.filter(e => e.kind === 'you').map((e: any) => e.text).join(' ');
  const said = transcriptLines(evs.filter(e => e.kind === 'guide'), 1e9).map(l => l.words.map(w => w.w).join(' ')).join(' ').trim();
  const qw = new Set(words(q.text)), hw = new Set(words(heard));
  const asked = q.interrupt && i > 0 ? `[asked "${FILLER}", then talked over the guide's answer with:] ${q.text}` : q.text;
  return { q: asked, heard: voice ? heard.trim() : undefined, heardRecall: voice ? +([...qw].filter(w => hw.has(w)).length / qw.size).toFixed(2) : undefined,
    said, words: words(said).length, tools: tools.map(t => `${t.name}${t.result?.error ? '✗' : ''}${t.name === 'show_diagram' ? `(${t.args.id}${t.args.part ? '.' + t.args.part : ''})` : t.name === 'start_custom' ? `(${t.args.base ?? 'scratch'})` : t.name === 'add_step' ? `[${(t.args.ops || []).map((o: any) => `${o.op}${o.target ? ':' + o.target : ''}${o.text ? ` "${String(o.text).slice(0, 40)}"` : ''}${o.label ? ` "${o.label}"` : ''}`).join(', ')}]` : t.name === 'draw_from_scratch' ? `(${t.args.type})` : t.name === 'scratch_ready' && t.result?.spec ? `{drew: ${JSON.stringify(t.result.spec).match(/"label":"[^"]+"/g)?.slice(0, 8).map((x: string) => x.slice(9, -1)).join(' | ') ?? ''}}` : ''}`).join(' '),
    toolErrors: tools.filter(t => t.result?.error).map(t => `${t.name}: ${String(t.result.error).slice(0, 140)}`) };
});

let grades: any[] = [];
if (judge) {
  const G = z.object({ grades: z.array(z.object({ index: z.number().int(), answered: z.number().int().min(1).max(5), faithful: z.number().int().min(1).max(5), spoken: z.number().int().min(1).max(5), screen: z.number().int().min(1).max(5), issues: z.array(z.string()) })) });
  const notes = `${digest.title}\n${digest.gist}\nNew idea: ${digest.newIdea.text}\n${digest.claims.map(c => '- ' + c.text).join('\n')}\n${digest.findings.map(c => '- ' + c.text).join('\n')}\nLimitations:\n${digest.limitations.map(c => '- ' + c.text).join('\n')}\nRelated: ${digest.related.map(r => `${r.label}: ${r.link}`).join('\n')}`;
  const r = await generateJSON({ stage: 'judge-live', schema: G, thinking: 'low', system: readFileSync(new URL('./judge.md', import.meta.url), 'utf8'),
    user: `# Paper notes\n${notes}\n\n# Diagrams\n${manifest(diagrams)}\n\n# Exchanges\n${JSON.stringify(exchanges.map((x, index) => ({ index, question: x.q, heardAs: x.heard, guideSaid: x.said, toolCalls: x.tools, toolErrors: x.toolErrors })), null, 1)}` });
  grades = r.value.grades;
}

const avg = (k: string) => grades.length ? +(grades.reduce((a, g) => a + g[k], 0) / grades.length).toFixed(2) : null;
const summary = {
  prompt: templateFile || 'prompts/live.md', mode: (flag('--blocking') ? 'blocking ' : 'nonblocking ') + (voice ? `voice echo=${echoGain} gate=${gateOn} vad=${flag('--default-vad') ? 'default' : opt('--vad') || 'low'}` : 'text'),
  answered: avg('answered'), faithful: avg('faithful'), spoken: avg('spoken'), screen: avg('screen'),
  toolErrors: exchanges.reduce((n, x) => n + x.toolErrors.length, 0), silentAnswers: exchanges.filter(x => !x.words).length,
  meanWords: +(exchanges.reduce((n, x) => n + x.words, 0) / exchanges.length).toFixed(0),
  ...(voice ? { serverInterruptions: interrupted, gateBarges: gate.stats.barges, falseBarges, echoShareOfHeard: +echoShare.toFixed(2), meanHeardRecall: +(exchanges.reduce((n, x) => n + (x.heardRecall || 0), 0) / exchanges.length).toFixed(2) } : {}),
};
const log: SessionLog = { id: `eval-${voice ? 'voice' : 'text'}-${randomUUID().slice(0, 6)}`, paperId, startedAt: new Date().toISOString(), duration: now(), events, customs: st.get().customs, title: `Eval: ${summary.mode}` };
if (flag('--save')) store.put(paperId, `sessions/${log.id}.json`, log);
const dir = join(store.DATA, 'eval'); mkdirSync(dir, { recursive: true });
const out = join(dir, `live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ summary, exchanges: exchanges.map((x, i) => ({ ...x, grade: grades.find(g => g.index === i) })), events }, null, 1));
for (const [i, x] of exchanges.entries()) {
  const g = grades.find(g => g.index === i);
  console.log(`\nQ${i + 1}: ${x.q}${x.heard != null ? `\n    heard: "${x.heard.slice(0, 120)}" (recall ${x.heardRecall})` : ''}\n    tools: ${x.tools || '—'}\n    said (${x.words}w): ${x.said.slice(0, 260)}${x.toolErrors.length ? `\n    ERR: ${x.toolErrors.join(' | ')}` : ''}${g ? `\n    grade a${g.answered} f${g.faithful} s${g.spoken} sc${g.screen}  ${g.issues.join('; ')}` : ''}`);
}
console.log('\nSUMMARY', JSON.stringify(summary));
console.log('report:', out, flag('--save') ? `\nsession: ${log.id}` : '');
process.exit(0);
