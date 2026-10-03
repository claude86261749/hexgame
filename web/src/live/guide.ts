// The live guide session: connects to gemini-3.8-live with an ephemeral token, streams audio both ways,
// executes tool calls against the diagram state, and keeps a log of the session (saved when it ends).
import { GoogleGenAI, Modality, FunctionResponseScheduling, type LiveServerMessage, type Session } from '@google/genai';
import type { Diagram, SessionEvent, SessionLog } from '../../../shared/schema';
import { applyTool, type GuideState } from '../../../shared/session';
import { execTool, settle } from '../../../shared/executor';
import { Mic, Speaker, toB64 } from './audio';
import { EchoGate, toPcm16 } from '../../../shared/duplex';
import { api } from '../api';

export type GuideStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';
export interface GuideCallbacks {
  onEvent: (e: SessionEvent) => void; onState: (s: GuideState) => void; onStatus: (s: GuideStatus, msg?: string) => void;
  onLevel?: (l: number) => void; onSpeaking?: (b: boolean) => void;
}

export class Guide {
  private session?: Session; private mic?: Mic; private speaker = new Speaker();
  private batch: Float32Array[] = [];
  /** Holds mic audio back while the guide is talking, unless the reader clearly talks over it. */
  readonly gate = new EchoGate(f => this.queueMic(f), () => this.bargeIn());
  private t0 = 0; private handle?: string; private closing = false; private nCustom = 0;
  events: SessionEvent[] = [];
  readonly id = crypto.randomUUID();
  private startedAt = new Date().toISOString();
  constructor(private paperId: string, private diagrams: Diagram[], public state: GuideState, private cb: GuideCallbacks) {}

  private now() { return (performance.now() - this.t0) / 1000; }
  private emit(e: SessionEvent) { this.events.push(e); this.cb.onEvent(e); }
  private setState(s: GuideState) { this.state = s; this.cb.onState(s); }

  async start(opts: { voice: boolean; onScreen?: string }) {
    this.speaker.unlock();
    this.t0 = performance.now();
    this.cb.onStatus('connecting');
    await this.connect();
    if (opts.voice) await this.setMic(true);
    // a silent nudge so the guide greets the reader; not recorded as a reader line
    this.session!.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `(The reader has opened the guide. On screen: ${opts.onScreen || 'the first diagram'}.)` }] }], turnComplete: true });
  }
  /** The reader moved to another diagram by hand: tell the guide without asking it to answer. */
  lookingAt(what: string) {
    try { this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `(The reader opened ${what}.)` }] }], turnComplete: false }); } catch { /* not connected yet */ }
  }

  private async connect() {
    const { token, model, config } = await api.liveToken(this.paperId);
    this.nonBlocking = new Set(config.tools[0].functionDeclarations.filter((d: any) => d.behavior === 'NON_BLOCKING').map((d: any) => d.name));
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    this.session = await ai.live.connect({
      model, config: { ...config, responseModalities: [Modality.AUDIO], sessionResumption: { handle: this.handle } },
      callbacks: {
        onopen: () => this.cb.onStatus('live'),
        onmessage: m => this.onMessage(m),
        onerror: e => this.cb.onStatus('error', String((e as any)?.message || 'connection error')),
        onclose: e => { if (!this.closing) this.reconnect(`closed ${e.code}`); },
      },
    });
  }
  private async reconnect(why: string) {
    if (this.closing) return;
    this.cb.onStatus('reconnecting', why);
    try { await this.connect(); } catch (e) { this.cb.onStatus('error', String(e)); }
  }

  async setMic(on: boolean) {
    if (on && !this.mic) {
      this.mic = new Mic();
      let lvl = 0;
      await this.mic.start(f => {
        let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
        lvl = Math.max(Math.sqrt(s / f.length), lvl * 0.85); this.cb.onLevel?.(lvl);
        const t = performance.now(); this.gate.push(f, t, this.speaker.levelAt(t));
      });
    } else if (!on && this.mic) { this.mic.stop(); this.mic = undefined; this.flushMic(); this.session?.sendRealtimeInput({ audioStreamEnd: true }); }
  }
  /** Headphones: no echo to fear, so the reader may talk over the guide freely. */
  setHeadphones(on: boolean) { this.gate.o.enabled = !on; }
  // forwarded mic frames are batched into 100 ms messages
  private queueMic(f: Float32Array) { this.batch.push(f); if (this.batch.length >= 5) this.flushMic(); }
  private flushMic() {
    if (!this.batch.length) return;
    const n = this.batch.reduce((a, b) => a + b.length, 0), all = new Float32Array(n); let o = 0;
    for (const b of this.batch) { all.set(b, o); o += b.length; }
    this.batch = [];
    this.session?.sendRealtimeInput({ audio: { data: toB64(toPcm16(all)), mimeType: 'audio/pcm;rate=16000' } });
  }
  /** After a barge-in, the rest of the interrupted answer may still stream in; don't play it. */
  private dropTurn = false;
  private bargeIn() { this.dropTurn = true; this.speaker.flush(); this.cb.onSpeaking?.(false); }
  /** Stop button / Esc: cut the guide off and listen. */
  interrupt() { this.bargeIn(); this.gate.playbackStopped(performance.now()); }
  get micOn() { return !!this.mic; }
  setMuted(m: boolean) { this.speaker.muted = m; if (m) { this.speaker.flush(); this.gate.playbackStopped(performance.now()); } }

  sendText(text: string) {
    this.speaker.flush(); this.gate.playbackStopped(performance.now());
    this.emit({ t: this.now(), kind: 'you', text });
    this.session?.sendRealtimeInput({ text });
  }

  private speakTimer?: number;
  private onMessage(m: LiveServerMessage) {
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) this.reconnect('server asked to reconnect');
    if (m.toolCall?.functionCalls) for (const f of m.toolCall.functionCalls) this.runTool(f.id!, f.name!, f.args || {});
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) this.emit({ t: this.now(), kind: 'you', text: sc.inputTranscription.text });
    if (sc.outputTranscription?.text) this.lastSpeech = this.now();
    if (sc.outputTranscription?.text && !this.dropTurn) this.emit({ t: this.now(), kind: 'guide', text: sc.outputTranscription.text });
    if (sc.interrupted || sc.turnComplete) this.dropTurn = false;
    for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data && !this.dropTurn) {
      const until = this.speaker.play(p.inlineData.data);
      if (until != null) this.gate.playbackUntil(until);
      this.cb.onSpeaking?.(true);
      clearTimeout(this.speakTimer); this.speakTimer = window.setTimeout(() => this.cb.onSpeaking?.(this.speaker.speaking), 400);
    }
    if (sc.interrupted) { this.speaker.flush(); this.gate.playbackStopped(performance.now()); }
    if (sc.turnComplete) this.emit({ t: this.now(), kind: 'turn' });
  }

  /* ---------------- tool executor (shared/executor.ts): validate, apply, record, respond */
  private record = (name: string, args: unknown, result: unknown) => {
    this.emit({ t: this.now(), kind: 'tool', name, args: args as Record<string, unknown>, result });
    if (!(result as any)?.error || name === 'scratch_ready') this.setState(applyTool(this.state, name, args, result));
  };
  private lastSpeech = -1;
  private nonBlocking = new Set<string>();
  private async runTool(id: string, name: string, raw: unknown) {
    const t0 = this.now();
    const r = await execTool({
      diagrams: this.diagrams, state: () => this.state, record: this.record, nextCustomId: () => `c${++this.nCustom}`,
      scratch: a => api.scratch(this.paperId, a), section: sid => api.section(this.paperId, sid),
    }, name, raw);
    const out = await settle(r, this.nonBlocking.has(name), t0 * 1000, t => this.lastSpeech * 1000 > t, () => this.now() * 1000);
    this.session?.sendToolResponse({ functionResponses: [{ id, name, response: out.response, ...(out.scheduling ? { scheduling: FunctionResponseScheduling[out.scheduling] } : {}) }] });
  }

  async stop(): Promise<SessionLog> {
    this.closing = true;
    await this.setMic(false);
    this.speaker.close(); this.session?.close();
    this.cb.onStatus('closed');
    const log: SessionLog = { id: this.id, paperId: this.paperId, startedAt: this.startedAt, duration: this.now(), events: this.events, customs: this.state.customs };
    if (this.events.some(e => e.kind === 'you')) await api.saveSession(this.paperId, log);
    return log;
  }
}
