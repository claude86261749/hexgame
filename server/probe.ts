// M0 probe: verifies the key, both models and every API feature the app relies on.
// Writes server/model-capabilities.json. Run: npm run probe
import { writeFileSync } from 'node:fs';
import { GoogleGenAI, Modality, Type, Behavior, FunctionResponseScheduling } from '@google/genai';
import { z } from 'zod';
import { MODELS } from '../shared/config.ts';
import { apiKey, toGeminiSchema } from './gemini.ts';

const ai = new GoogleGenAI({ apiKey: apiKey() });
const out: Record<string, unknown> = { at: new Date().toISOString(), models: MODELS };
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t0 = Date.now();
  try { out[name] = { ok: true, ms: Date.now() - t0, ...(await fn() as object) }; }
  catch (e: any) { out[name] = { ok: false, error: String(e?.message || e).slice(0, 400) }; }
  (out[name] as any).ms = Date.now() - t0;
  console.log(name.padEnd(22), (out[name] as any).ok ? 'ok ' : 'FAIL', JSON.stringify(out[name]).slice(0, 220));
};

await step('models', async () => {
  const names: string[] = [];
  for await (const m of await ai.models.list({ config: { pageSize: 1000 } })) names.push(m.name!.replace('models/', ''));
  for (const m of Object.values(MODELS)) if (!names.includes(m)) throw new Error(`missing ${m}`);
  return { count: names.length };
});

await step('flash_json_schema', async () => {
  const S = z.object({ nodes: z.array(z.object({ id: z.string(), label: z.string().max(30), kind: z.enum(['input', 'step']).optional() })).min(2).max(4) });
  const r = await ai.models.generateContent({ model: MODELS.flash, contents: 'Two-step diagram of making tea.',
    config: { responseMimeType: 'application/json', responseJsonSchema: toGeminiSchema(S), thinkingConfig: { thinkingLevel: 'low' as any } } });
  return { parsed: S.parse(JSON.parse(r.text!)), thoughts: r.usageMetadata?.thoughtsTokenCount ?? 0 };
});

await step('live_nonblocking_tool', () => new Promise(async (resolve, reject) => {
  const ev = { calls: [] as string[], transcript: '', turns: 0, audio: 0 };
  const timer = setTimeout(() => { s.close(); resolve({ ...ev, note: 'timeout' }); }, 40000);
  const s = await ai.live.connect({ model: MODELS.live, config: {
    responseModalities: [Modality.AUDIO], outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} }, sessionResumption: {},
    systemInstruction: 'When asked to draw something, call draw (it is slow) and keep talking briefly while it runs.',
    tools: [{ functionDeclarations: [{ name: 'draw', behavior: Behavior.NON_BLOCKING, description: 'Draw a diagram (slow).',
      parameters: { type: Type.OBJECT, properties: { brief: { type: Type.STRING } }, required: ['brief'] } }] }] },
    callbacks: {
      onmessage: m => {
        if (m.toolCall) for (const f of m.toolCall.functionCalls!) {
          ev.calls.push(f.name!);
          setTimeout(() => s.sendToolResponse({ functionResponses: [{ id: f.id, name: f.name, response: { ok: true, drawn: 'a 3-node flow', scheduling: FunctionResponseScheduling.WHEN_IDLE } }] }), 1500);
        }
        if (m.sessionResumptionUpdate?.newHandle) (ev as any).resumable = true;
        const sc = m.serverContent;
        if (sc?.outputTranscription?.text) ev.transcript += sc.outputTranscription.text;
        for (const p of sc?.modelTurn?.parts || []) if (p.inlineData) ev.audio += p.inlineData.data!.length;
        if (sc?.turnComplete && ++ev.turns >= 2) { clearTimeout(timer); s.close(); resolve(ev); }
      },
      onerror: e => reject(new Error(String((e as any)?.message || e))),
      onclose: e => { if (e.code !== 1000) reject(new Error(`closed ${e.code} ${e.reason}`)); },
    } });
  s.sendRealtimeInput({ text: 'Please draw the training pipeline.' });
}));

await step('ephemeral_token', async () => {
  const t = await ai.authTokens.create({ config: { uses: 1, expireTime: new Date(Date.now() + 30 * 60e3).toISOString(),
    newSessionExpireTime: new Date(Date.now() + 60e3).toISOString(), liveConnectConstraints: { model: MODELS.live },
    httpOptions: { apiVersion: 'v1alpha' } } });
  return { prefix: t.name!.slice(0, 12) };
});

writeFileSync(new URL('./model-capabilities.json', import.meta.url), JSON.stringify(out, null, 2));
