export type RGB = [number, number, number];

export const WHITE: RGB = [255, 255, 255];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function hex2rgb(h: string): RGB {
  h = h.trim().replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB, al?: number) =>
  al === undefined || al >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`;

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* themes are blended in OKLab so neighbouring hues shade into each other without going grey */
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (c: number) => clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055, 0, 1) * 255;
export function rgb2lab(c: RGB): RGB {
  const r = toLin(c[0]), g = toLin(c[1]), b = toLin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function lab2rgb(c: RGB): RGB {
  const l = Math.pow(c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2], 3);
  const m = Math.pow(c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2], 3);
  const s = Math.pow(c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2], 3);
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
export const lum = (c: RGB) => 0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]);

export const WHEEL_HEX = ['#86C74F', '#22B8A6', '#3DB7E4', '#5B8DEF', '#8A78EE', '#B76AE0', '#F0655A', '#F59C3C', '#E4C42E'];
const WHEEL = WHEEL_HEX.map(h => rgb2lab(hex2rgb(h)));
/** Colour of the tile at the centre of the map. */
export const CORE = hex2rgb('#E8479B');

/* colour is a function of position: hue turns with bearing from the centre, and lightens outward */
export function wheelColour(bearing: number, rad: number): RGB {
  const x = ((bearing % 360) + 360) % 360 / 360 * WHEEL.length, i = Math.floor(x) % WHEEL.length, f = x - Math.floor(x);
  const a = WHEEL[i], b = WHEEL[(i + 1) % WHEEL.length];
  const lab: RGB = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  lab[0] = clamp(lab[0] + clamp((rad - 3) * 0.014, -0.04, 0.05), 0, 1);
  return lab2rgb(lab);
}
