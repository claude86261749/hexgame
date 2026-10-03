// Text metrics without a DOM, so the server-side lint and the renderer agree.
// Widths approximate Schibsted Grotesk; good to a few percent, which is what layout needs.
const NARROW = new Set([...'iljtfrI.,:;\'!|()[]{} ']);
const WIDE = new Set([...'mwMW@%']);
export function charW(c: string): number {
  if (NARROW.has(c)) return 0.3;
  if (WIDE.has(c)) return 0.86;
  if (c >= 'A' && c <= 'Z') return 0.66;
  if (c >= '0' && c <= '9') return 0.56;
  if (c.charCodeAt(0) > 0x2000) return 0.7;
  return 0.53;
}
export function textW(s: string, size = 11.5, bold = false): number {
  let w = 0;
  for (const c of s) w += charW(c);
  return w * size * (bold ? 1.06 : 1);
}
/** Greedy word wrap. Words longer than the line are left whole (and reported by the caller's lint). */
export function wrap(s: string, maxW: number, size = 11.5, bold = false): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && textW(next, size, bold) > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
export const maxLineW = (lines: string[], size = 11.5, bold = false) => Math.max(0, ...lines.map(l => textW(l, size, bold)));
