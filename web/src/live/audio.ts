// Mic capture → 16 kHz PCM16 chunks; model audio (24 kHz PCM16) → gapless playback with instant flush on interruption.
const CAPTURE = `
class Cap extends AudioWorkletProcessor {
  constructor(){ super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; this.lvl = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { this.lvl = Math.max(this.lvl * 0.9995, Math.abs(ch[i])); this.acc += 1; if (this.acc >= this.ratio) { this.acc -= this.ratio; this.buf.push(ch[i]); } }
    if (this.buf.length >= 1600) {
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < out.length; i++) { const s = Math.max(-1, Math.min(1, this.buf[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage({ pcm: out.buffer, level: this.lvl }, [out.buffer]); this.buf = [];
    }
    return true;
  }
}
registerProcessor('cap', Cap);`;

export function toB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Int16Array {
  const bin = atob(s); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Int16Array(b.buffer, 0, b.length >> 1);
}

export class Mic {
  private ctx?: AudioContext; private stream?: MediaStream; private node?: AudioWorkletNode;
  async start(onChunk: (b64: string) => void, onLevel?: (l: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE], { type: 'text/javascript' })));
    this.node = new AudioWorkletNode(this.ctx, 'cap');
    this.node.port.onmessage = e => { onChunk(toB64(e.data.pcm)); onLevel?.(e.data.level); };
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
  }
  stop() { this.stream?.getTracks().forEach(t => t.stop()); this.node?.disconnect(); this.ctx?.close(); this.ctx = undefined; }
}

export class Speaker {
  private ctx?: AudioContext; private next = 0; private live: AudioBufferSourceNode[] = [];
  muted = false;
  private ensure() { if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 24000 }); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
  unlock() { this.ensure(); }
  play(b64: string) {
    if (this.muted) return;
    const ctx = this.ensure(), pcm = fromB64(b64);
    const buf = ctx.createBuffer(1, pcm.length, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    this.next = Math.max(this.next, ctx.currentTime + 0.03); src.start(this.next); this.next += buf.duration;
    this.live.push(src); src.onended = () => { this.live = this.live.filter(s => s !== src); };
  }
  get speaking() { return this.live.length > 0; }
  flush() { this.live.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }); this.live = []; this.next = 0; }
  close() { this.flush(); this.ctx?.close(); this.ctx = undefined; }
}
