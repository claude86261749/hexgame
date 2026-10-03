// The model-call harness. Every flash call goes through generateJSON:
//   JSON-schema-constrained output → zod parse → caller's semantic/layout checks → repair turns → result.
// Plus: retry with backoff on 429/5xx, a concurrency gate, a content-addressed cache,
// JSONL call logs, and GEMINI_MOCK=1 (cache-only replay, no key needed).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleGenAI, type Content } from '@google/genai';
import { z } from 'zod';
import { MODELS } from '../shared/config.ts';
import { DATA } from './store.ts';
import { prompt } from './prompts.ts';

export function apiKey(): string {
  const k = process.env.GEMINI_API_KEY || process.env.AI_STUDIO_KEY || process.env.GOOGLE_API_KEY;
  if (!k) throw new Error('No Gemini key: set GEMINI_API_KEY (or AI_STUDIO_KEY)');
  return k.trim();
}
const MOCK = process.env.GEMINI_MOCK === '1';
let _ai: GoogleGenAI | null = null;
export const ai = () => (_ai ??= new GoogleGenAI({ apiKey: apiKey() }));

const DROP = new Set(['$schema', 'additionalProperties', '$id', 'default', 'pattern']);
/** zod → JSON Schema in the subset Gemini's responseJsonSchema accepts. */
export function toGeminiSchema(s: z.ZodType): unknown {
  // minItems/maxItems on arrays of objects blow up Gemini's constrained-decoding state space (400 INVALID_ARGUMENT);
  // those limits are still enforced by zod and fixed through the repair loop.
  const objArray = (v: any) => v?.type === 'array' && (v.items?.type === 'object' || v.items?.anyOf || v.items?.oneOf);
  const strip = (v: any): any => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k) && !(objArray(v) && (k === 'minItems' || k === 'maxItems')))
        .map(([k, x]) => [k === 'oneOf' ? 'anyOf' : k, strip(x)])) : v;
  return strip(z.toJSONSchema(s, { target: 'draft-7', unrepresentable: 'any', io: 'input' }));
}

/* ---------------- concurrency gate */
let active = 0; const queue: (() => void)[] = [];
const LIMIT = Number(process.env.GEMINI_CONCURRENCY || 6);
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) await new Promise<void>(r => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

/* ---------------- logging + cache */
const CACHE = join(DATA, 'cache'), LOGS = join(DATA, 'logs');
mkdirSync(CACHE, { recursive: true }); mkdirSync(LOGS, { recursive: true });
function log(entry: Record<string, unknown>) { appendFileSync(join(LOGS, 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); }
export const callStats = { calls: 0, cached: 0, inTok: 0, outTok: 0, thoughtTok: 0, ms: 0 };

interface RawOpts { stage: string; system: string; contents: Content[]; schema: unknown; thinking?: 'low' | 'high'; temperature?: number; model?: string }
async function rawCall(o: RawOpts): Promise<string> {
  const model = o.model || MODELS.flash;
  const key = createHash('sha256').update(JSON.stringify([model, o.system, o.contents, o.schema, o.thinking, o.temperature])).digest('hex');
  const file = join(CACHE, key + '.json');
  if (existsSync(file) && process.env.GEMINI_NO_CACHE !== '1') { callStats.cached++; log({ stage: o.stage, cached: true }); return JSON.parse(readFileSync(file, 'utf8')).text; }
  if (MOCK) throw new Error(`GEMINI_MOCK: no cached response for stage ${o.stage}`);
  return gate(async () => {
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      try {
        const r = await ai().models.generateContent({ model, contents: o.contents, config: {
          systemInstruction: o.system, responseMimeType: 'application/json', responseJsonSchema: o.schema,
          temperature: o.temperature ?? 0.3, thinkingConfig: { thinkingLevel: (o.thinking || 'low') as any } } });
        const text = r.text || '';
        const u = r.usageMetadata || {};
        const ms = Date.now() - t0;
        Object.assign(callStats, { calls: callStats.calls + 1, inTok: callStats.inTok + (u.promptTokenCount || 0), outTok: callStats.outTok + (u.candidatesTokenCount || 0), thoughtTok: callStats.thoughtTok + (u.thoughtsTokenCount || 0), ms: callStats.ms + ms });
        log({ stage: o.stage, model, ms, in: u.promptTokenCount, out: u.candidatesTokenCount, thoughts: u.thoughtsTokenCount, finish: r.candidates?.[0]?.finishReason });
        if (!text) throw Object.assign(new Error(`empty response (${r.candidates?.[0]?.finishReason})`), { retry: true });
        writeFileSync(file, JSON.stringify({ stage: o.stage, text }));
        return text;
      } catch (e: any) {
        const status = e?.status ?? e?.code ?? Number(String(e?.message).match(/\b(429|500|502|503|504)\b/)?.[1]);
        const retry = e?.retry || [429, 500, 502, 503, 504].includes(status) || /fetch failed|ECONNRESET|socket/i.test(String(e?.message));
        log({ stage: o.stage, model, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 300), attempt });
        if (!retry || attempt >= 4) throw e;
        await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
  });
}

export interface GenResult<T> { value: T; repairs: number; warnings: string[] }
export class GenError extends Error { constructor(msg: string, public issues: string[], public last?: unknown) { super(msg); } }

/**
 * Generate JSON that satisfies `schema` and `check`. `check` returns errors (sent back for repair)
 * and may mutate the value to auto-fix trivia (returning warnings).
 */
export async function generateJSON<S extends z.ZodType>(o: {
  stage: string; system: string; user: string; schema: S; thinking?: 'low' | 'high'; temperature?: number; maxRepairs?: number;
  check?: (v: z.infer<S>) => { errors: string[]; warnings?: string[] };
}): Promise<GenResult<z.infer<S>>> {
  const js = toGeminiSchema(o.schema);
  const contents: Content[] = [{ role: 'user', parts: [{ text: o.user }] }];
  const max = o.maxRepairs ?? 2;
  let lastErrors: string[] = [], last: unknown;
  for (let round = 0; round <= max; round++) {
    const text = await rawCall({ stage: round ? `${o.stage}:repair${round}` : o.stage, system: o.system, contents, schema: js, thinking: o.thinking, temperature: o.temperature });
    let errors: string[] = [], warnings: string[] = [];
    let value: any;
    try { value = JSON.parse(text); } catch { errors = ['response is not valid JSON']; }
    if (value !== undefined) {
      last = value;
      const p = o.schema.safeParse(value);
      if (!p.success) errors = p.error.issues.slice(0, 20).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`);
      else {
        value = p.data;
        const c = o.check?.(value);
        if (c) { errors = c.errors; warnings = c.warnings || []; }
      }
    }
    if (!errors.length) return { value, repairs: round, warnings };
    lastErrors = errors;
    contents.push({ role: 'model', parts: [{ text }] }, { role: 'user', parts: [{ text: prompt('repair') + '\n\nErrors:\n- ' + errors.join('\n- ') }] });
  }
  throw new GenError(`${o.stage}: still invalid after ${max} repairs`, lastErrors, last);
}
