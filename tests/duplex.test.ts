import { describe, it, expect } from 'vitest';
import { EchoGate, resample, toPcm16, fromPcm16 } from '../shared/duplex.ts';

const tone = (amp: number, n = 320, f = 220) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / 16000));

describe('EchoGate', () => {
  it('holds back echo while the guide is playing, and opens after the tail', () => {
    const sent: Float32Array[] = []; let barges = 0;
    const g = new EchoGate(f => sent.push(f), () => barges++);
    g.playbackUntil(1000);
    for (let t = 0; t < 1000; t += 20) g.push(tone(0.08), t, 0.1);     // loud echo of the guide (playing at rms 0.1)
    expect(sent.length).toBe(0); expect(barges).toBe(0);
    for (let t = 1000; t < 1400; t += 20) g.push(tone(0.08 * Math.exp(-(t - 1000) / 60)), t, 0); // echo dying out inside the tail
    expect(sent.length).toBe(0);
    g.push(tone(0.01), 1500);                                           // after the tail: open
    expect(sent.length).toBe(1);
  });
  it('lets the reader barge in when clearly louder than the echo, with preroll', () => {
    const sent: Float32Array[] = []; let barges = 0;
    const g = new EchoGate(f => sent.push(f), () => barges++);
    g.playbackUntil(5000);
    for (let t = 0; t < 1000; t += 20) g.push(tone(0.03), t, 0.1);     // coupling learned (~0.2)
    let t = 1000; for (; barges === 0 && t < 2000; t += 20) g.push(tone(0.4, 320, 180), t, 0.1); // reader speaks up
    expect(barges).toBe(1);
    expect(t - 1000).toBeLessThanOrEqual(300);
    expect(sent.length).toBeGreaterThanOrEqual(10);                    // preroll forwarded
    g.push(tone(0.4), t); expect(sent.length).toBeGreaterThanOrEqual(11); // and the gate stays open
  });
  it('without a reference level, does not mistake echo at the start of playback for a barge-in', () => {
    let barges = 0;
    const g = new EchoGate(() => {}, () => barges++);
    g.playbackUntil(3000);
    for (let t = 0; t < 3000; t += 20) g.push(tone(0.08), t);
    expect(barges).toBe(0);
  });
  it('does nothing when disabled (headphones)', () => {
    const sent: Float32Array[] = [];
    const g = new EchoGate(f => sent.push(f), () => {}, { enabled: false });
    g.playbackUntil(1000); g.push(tone(0.08), 10);
    expect(sent.length).toBe(1);
  });
});

describe('audio helpers', () => {
  it('round-trips PCM16 and resamples to the right length', () => {
    const x = tone(0.5, 2400);
    const y = fromPcm16(toPcm16(x));
    expect(Math.abs(y[100] - x[100])).toBeLessThan(1e-3);
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resample(new Float32Array(24000), 24000, 16000).length).toBe(16000);
  });
});
