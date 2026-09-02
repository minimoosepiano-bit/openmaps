/* Small shared helpers. */
'use strict';

const Util = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); },

  /* Deterministic PRNG (mulberry32). */
  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  },
  hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  },

  /* Colour helpers. Colours are stored as '#rrggbb' strings. */
  hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  rgbToHex(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  },
  hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Util.rgbToHex(Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255));
  },
  /* Pack rgb into little-endian ABGR uint32 for ImageData writes. */
  packRgb(r, g, b) { return (255 << 24) | (b << 16) | (g << 8) | r; },
  darken(hex, f) {
    const [r, g, b] = Util.hexToRgb(hex);
    return Util.rgbToHex(Math.round(r * f), Math.round(g * f), Math.round(b * f));
  },
  luminance(hex) {
    const [r, g, b] = Util.hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  },

  /* Name generator for nations. */
  nationName(rand) {
    const A = ['Al', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gal', 'Har', 'Ist', 'Kar', 'Lor', 'Mar', 'Nor', 'Ost', 'Pel', 'Ran', 'Sar', 'Tor', 'Ul', 'Var', 'Wes', 'Yor', 'Zan', 'Ar', 'Bra', 'Cas', 'Dun', 'Er'];
    const B = ['an', 'en', 'in', 'on', 'ar', 'or', 'ul', 'am', 'em', 'ath', 'oth', 'ia', 'ea', 'ov', 'av', 'ur'];
    const C = ['ia', 'land', 'mark', 'stan', 'gard', 'ria', 'nia', 'dor', 'heim', 'wick', 'grad', 'ova', 'ium', 'ica', 'esse', 'burg'];
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    let n = pick(A) + (rand() < 0.5 ? pick(B) : '') + pick(C);
    return n.charAt(0).toUpperCase() + n.slice(1);
  },

  /* Base64 helpers for typed arrays (chunked: fromCharCode.apply overflows on big arrays). */
  b64(arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  unb64(s) {
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  download(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  $(id) { return document.getElementById(id); },
};
