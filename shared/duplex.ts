// Echo gate: keeps the guide from hearing itself.
//
// Browser echo cancellation is unreliable for Web Audio playback, so speaker output leaks into the mic,
// the server's voice activity detection takes it for the reader, and the guide interrupts and answers
// itself. The gate is half-duplex with barge-in: while the guide's audio is playing (plus a short tail
// for room echo) mic frames are held back, unless the mic is clearly louder than the echo it has been
// hearing for long enough to be a person talking over the guide. Then it fires onBargeIn (stop playback)
// and forwards the held-back preroll so the reader's first syllables are not lost.
//
// "Clearly louder than the echo": echo is the playback signal times a room coupling factor. When the caller
// passes the level of what the speaker is playing right now (ref), the gate learns that coupling from frames
// that are not speech, starting pessimistic (coupling 1: echo as loud as the playback itself), so loud echo at
// the start of an answer never counts as a barge-in. Without ref it falls back to a running echo level.
//
// Pure and clock-injected so the browser and the Node voice harness run the same code.

export interface GateOptions {
  enabled: boolean;
  tailMs: number;      // keep gating this long after playback ends (room echo, output latency)
  bargeRatio: number;  // speech must be this many times louder than the running echo level
  bargeMin: number;    // ...and at least this loud (RMS, 0..1)
  bargeMs: number;     // ...for this long
  prerollMs: number;   // audio forwarded on barge-in, from before it was detected
  frameMs: number;
  holdDecay: number;   // per-frame decay of the held reference level (covers output latency / reverb)
}
export const GATE_DEFAULTS: GateOptions = { enabled: true, tailMs: 400, bargeRatio: 2, bargeMin: 0.05, bargeMs: 200, prerollMs: 500, frameMs: 20, holdDecay: 0.85 };

export const rms = (f: Float32Array) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / Math.max(1, f.length)); };

export type GateDecision = 'open' | 'held' | 'barge';

export class EchoGate {
  o: GateOptions;
  private playingUntil = 0;
  private echo = 0;
  private coupling = 1;
  private refHold = 0;
  private hot = 0;
  private held: Float32Array[] = [];
  stats = { open: 0, held: 0, barges: 0 };
  constructor(private forward: (f: Float32Array) => void, private onBargeIn: () => void, opts: Partial<GateOptions> = {}) {
    this.o = { ...GATE_DEFAULTS, ...opts };
  }
  /** The speaker reports when its queued audio will finish (ms, same clock as push). */
  playbackUntil(ms: number) { this.playingUntil = Math.max(this.playingUntil, ms); }
  /** Playback was stopped (interruption, mute). */
  playbackStopped(now: number) { this.playingUntil = Math.min(this.playingUntil, now); }
  gating(now: number) { return this.o.enabled && now < this.playingUntil + this.o.tailMs; }

  /** ref: RMS of the audio the speaker is playing at this moment, if known. */
  push(frame: Float32Array, now: number, ref?: number): GateDecision {
    if (!this.gating(now)) {
      if (this.held.length) { this.held = []; this.hot = 0; }
      this.forward(frame); this.stats.open++;
      return 'open';
    }
    const level = rms(frame);
    // output latency and room reverb lag the reference: hold its recent peak with a ~0.5 s decay
    if (ref != null) this.refHold = Math.max(ref, this.refHold * this.o.holdDecay);
    const expected = ref != null ? this.coupling * this.refHold : this.echo;
    const thresh = Math.max(this.o.bargeMin, expected * this.o.bargeRatio, ref == null ? this.o.bargeMin * 2 * Math.max(0, 1 - this.stats.held / 15) : 0);
    if (level > thresh) this.hot += this.o.frameMs;
    else {
      this.hot = Math.max(0, this.hot - this.o.frameMs);
      // learn only from frames that are not the reader talking
      // only while the speaker is clearly playing: in the gaps between words the held reference overstates the echo
      if (ref != null && ref > 0.02) this.coupling = Math.min(1.5, Math.max(0.05, this.coupling * 0.92 + (level / ref) * 0.08));
      this.echo = this.echo * 0.9 + level * 0.1;
    }
    this.held.push(frame);
    const keep = Math.ceil(this.o.prerollMs / this.o.frameMs);
    if (this.held.length > keep) this.held.splice(0, this.held.length - keep);
    if (this.hot >= this.o.bargeMs) {
      this.stats.barges++;
      this.playingUntil = 0; this.hot = 0;
      this.onBargeIn();
      for (const f of this.held) this.forward(f);
      this.held = [];
      return 'barge';
    }
    this.stats.held++;
    return 'held';
  }
}

/** Float32 [-1,1] → little-endian PCM16 bytes. */
export function toPcm16(f: Float32Array): Uint8Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return new Uint8Array(out.buffer);
}
export function fromPcm16(b: Uint8Array): Float32Array {
  const i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1), out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}
/** Linear-interpolating resampler with a box pre-filter when downsampling (enough for speech). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  let src = x;
  if (to < from) { const k = Math.max(1, Math.round(from / to)); if (k > 1) { src = new Float32Array(x.length); let acc = 0; for (let i = 0; i < x.length; i++) { acc += x[i] - (i >= k ? x[i - k] : 0); src[i] = acc / Math.min(k, i + 1); } } }
  const n = Math.floor(src.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r, j = Math.floor(p), t = p - j; out[i] = (src[j] ?? 0) * (1 - t) + (src[j + 1] ?? src[j] ?? 0) * t; }
  return out;
}
