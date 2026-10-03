// Mic capture → 20 ms Float32 frames at 16 kHz (fed through the EchoGate by the caller);
// model audio (24 kHz PCM16) → gapless playback that reports when it will finish and flushes instantly.
import { resample, fromPcm16, rms } from '../../../shared/duplex';

const CAPTURE = `
class Cap extends AudioWorkletProcessor {
  constructor(o){ super(); this.n = o.processorOptions.frame; this.buf = new Float32Array(this.n); this.i = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let k = 0; k < ch.length; k++) { this.buf[this.i++] = ch[k]; if (this.i === this.n) { this.port.postMessage(this.buf.slice(0)); this.i = 0; } }
    return true;
  }
}
registerProcessor('cap', Cap);`;

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }

export class Mic {
  private ctx?: AudioContext; private stream?: MediaStream; private node?: AudioWorkletNode;
  /** onFrame receives 20 ms of 16 kHz audio. */
  async start(onFrame: (f: Float32Array) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    // Prefer a 16 kHz context: the browser then resamples the mic with a proper filter.
    let src: MediaStreamAudioSourceNode;
    try { this.ctx = new AudioContext({ sampleRate: 16000 }); src = this.ctx.createMediaStreamSource(this.stream); }
    catch { this.ctx?.close(); this.ctx = new AudioContext(); src = this.ctx.createMediaStreamSource(this.stream); }
    const rate = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE], { type: 'text/javascript' })));
    this.node = new AudioWorkletNode(this.ctx, 'cap', { processorOptions: { frame: Math.round(rate * 0.02) } });
    this.node.port.onmessage = e => onFrame(rate === 16000 ? e.data : resample(e.data, rate, 16000));
    src.connect(this.node);
  }
  stop() { this.stream?.getTracks().forEach(t => t.stop()); this.node?.disconnect(); this.ctx?.close(); this.ctx = undefined; }
}

export class Speaker {
  private ctx?: AudioContext; private next = 0; private live: AudioBufferSourceNode[] = [];
  private sched: { from: number; to: number; level: number }[] = [];
  muted = false;
  private ensure() { if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 24000 }); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
  unlock() { this.ensure(); }
  /** Queue a chunk; returns when (performance.now() ms) the queue will have finished playing, or null if muted. */
  play(b64: string): number | null {
    if (this.muted) return null;
    const ctx = this.ensure(), pcm = fromPcm16(fromB64(b64));
    const buf = ctx.createBuffer(1, pcm.length, 24000); buf.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime + 0.03); src.start(this.next); this.next += buf.duration;
    this.live.push(src); src.onended = () => { this.live = this.live.filter(s => s !== src); };
    const lat = (ctx.outputLatency || ctx.baseLatency || 0) * 1000, startMs = performance.now() + (this.next - buf.duration - ctx.currentTime) * 1000 + lat;
    // per-50 ms loudness of what will be heard, so the echo gate knows how loud the echo should be
    for (let i = 0; i < pcm.length; i += 1200) this.sched.push({ from: startMs + i / 24, to: startMs + Math.min(pcm.length, i + 1200) / 24, level: rms(pcm.subarray(i, i + 1200)) });
    const cut = performance.now() - 2000; while (this.sched.length && this.sched[0].to < cut) this.sched.shift();
    return performance.now() + (this.next - ctx.currentTime) * 1000 + lat;
  }
  get speaking() { return this.live.length > 0; }
  /** RMS of what the speaker is playing at time t (performance.now ms). */
  levelAt(t: number) { for (const c of this.sched) if (t >= c.from && t < c.to) return c.level; return 0; }
  flush() { this.live.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }); this.live = []; this.next = 0; this.sched = []; }
  close() { this.flush(); this.ctx?.close(); this.ctx = undefined; }
}
