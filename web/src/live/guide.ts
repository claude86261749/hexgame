// The live guide session: connects to gemini-3.8-live with an ephemeral token, streams audio both ways,
// executes tool calls against the diagram state, and records everything for replay.
import { GoogleGenAI, Modality, FunctionResponseScheduling, type LiveServerMessage, type Session } from '@google/genai';
import type { Diagram, SessionEvent, SessionLog } from '../../../shared/schema';
import { applyTool, type GuideState } from '../../../shared/session';
import { execTool } from '../../../shared/executor';
import { Mic, Speaker } from './audio';
import { api } from '../api';

export type GuideStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';
export interface GuideCallbacks {
  onEvent: (e: SessionEvent) => void; onState: (s: GuideState) => void; onStatus: (s: GuideStatus, msg?: string) => void;
  onLevel?: (l: number) => void; onSpeaking?: (b: boolean) => void;
}

export class Guide {
  private session?: Session; private mic?: Mic; private speaker = new Speaker();
  private t0 = 0; private handle?: string; private closing = false; private nCustom = 0;
  events: SessionEvent[] = [];
  readonly id = crypto.randomUUID();
  private startedAt = new Date().toISOString();
  constructor(private paperId: string, private diagrams: Diagram[], public state: GuideState, private cb: GuideCallbacks) {}

  private now() { return (performance.now() - this.t0) / 1000; }
  private emit(e: SessionEvent) { this.events.push(e); this.cb.onEvent(e); }
  private setState(s: GuideState) { this.state = s; this.cb.onState(s); }

  async start(opts: { voice: boolean }) {
    this.speaker.unlock();
    this.t0 = performance.now();
    this.cb.onStatus('connecting');
    await this.connect();
    if (opts.voice) await this.setMic(true);
    // a silent nudge so the guide greets the reader; not recorded as a reader line
    this.session!.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '(The reader has opened the guide. The first diagram is on screen.)' }] }], turnComplete: true });
  }

  private async connect() {
    const { token, model, config } = await api.liveToken(this.paperId);
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
      await this.mic.start(b64 => this.session?.sendRealtimeInput({ audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }), this.cb.onLevel);
    } else if (!on && this.mic) { this.mic.stop(); this.mic = undefined; this.session?.sendRealtimeInput({ audioStreamEnd: true }); }
  }
  get micOn() { return !!this.mic; }
  setMuted(m: boolean) { this.speaker.muted = m; if (m) this.speaker.flush(); }

  sendText(text: string) {
    this.speaker.flush();
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
    if (sc.outputTranscription?.text) this.emit({ t: this.now(), kind: 'guide', text: sc.outputTranscription.text });
    for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) {
      this.speaker.play(p.inlineData.data); this.cb.onSpeaking?.(true);
      clearTimeout(this.speakTimer); this.speakTimer = window.setTimeout(() => this.cb.onSpeaking?.(this.speaker.speaking), 400);
    }
    if (sc.interrupted) this.speaker.flush();
    if (sc.turnComplete) this.emit({ t: this.now(), kind: 'turn' });
  }

  /* ---------------- tool executor (shared/executor.ts): validate, apply, record, respond */
  private record = (name: string, args: unknown, result: unknown) => {
    this.emit({ t: this.now(), kind: 'tool', name, args: args as Record<string, unknown>, result });
    if (!(result as any)?.error || name === 'scratch_ready') this.setState(applyTool(this.state, name, args, result));
  };
  private async runTool(id: string, name: string, raw: unknown) {
    const r = await execTool({
      diagrams: this.diagrams, state: () => this.state, record: this.record, nextCustomId: () => `c${++this.nCustom}`,
      scratch: a => api.scratch(this.paperId, a), section: sid => api.section(this.paperId, sid),
    }, name, raw);
    this.session?.sendToolResponse({ functionResponses: [{ id, name, response: r.response, ...(r.background ? { scheduling: FunctionResponseScheduling.WHEN_IDLE } : {}) }] });
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
