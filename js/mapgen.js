/* Procedural terrain generation: layered value noise → elevation map (0..255). */
'use strict';

const MapGen = (() => {
  const SEA = 128; // cells with elevation < SEA are water

  function valueNoise(w, h, cell, rand) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const out = new Float32Array(w * h);
    const smooth = t => t * t * (3 - 2 * t);
    for (let y = 0; y < h; y++) {
      const gy = y / cell, y0 = Math.floor(gy), ty = smooth(gy - y0);
      for (let x = 0; x < w; x++) {
        const gx = x / cell, x0 = Math.floor(gx), tx = smooth(gx - x0);
        const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
        const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
        out[y * w + x] = Util.lerp(Util.lerp(a, b, tx), Util.lerp(c, d, tx), ty);
      }
    }
    return out;
  }

  function fbm(w, h, rand, baseCell, octaves) {
    const acc = new Float32Array(w * h);
    let amp = 1, total = 0, cell = baseCell;
    for (let o = 0; o < octaves; o++) {
      const n = valueNoise(w, h, Math.max(2, cell), rand);
      for (let i = 0; i < acc.length; i++) acc[i] += n[i] * amp;
      total += amp; amp *= 0.5; cell /= 2;
    }
    for (let i = 0; i < acc.length; i++) acc[i] /= total;
    return acc;
  }

  /**
   * @param {number} w
   * @param {number} h
   * @param {string} type continents | islands | pangea | blank-land | blank-water
   * @param {number} seed
   * @returns {Uint8Array} elevation
   */
  function generate(w, h, type, seed) {
    const elev = new Uint8Array(w * h);
    if (type === 'blank-land') { elev.fill(SEA + 40); return elev; }
    if (type === 'blank-water') { elev.fill(SEA - 40); return elev; }

    const rand = Util.rng(seed);
    const base = fbm(w, h, rand, Math.max(w, h) / 3.2, 6);
    const detail = fbm(w, h, rand, Math.max(w, h) / 14, 4);

    let landBias, edgeFall, detailMix;
    if (type === 'islands') { landBias = -0.10; edgeFall = 0.6; detailMix = 0.55; }
    else if (type === 'pangea') { landBias = 0.12; edgeFall = 1.4; detailMix = 0.25; }
    else { landBias = 0.02; edgeFall = 1.0; detailMix = 0.35; }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // radial falloff so oceans surround the land mass
        const nx = (x / w) * 2 - 1, ny = (y / h) * 2 - 1;
        const d = Math.sqrt(nx * nx + ny * ny);
        const fall = Math.max(0, 1 - Math.pow(d / 1.15, 3)) * edgeFall;
        let v = (base[i] * (1 - detailMix) + detail[i] * detailMix) - 0.5;
        v = v * 1.6 + landBias;
        v = v * fall + (fall - 0.5) * 0.35;
        // map to 0..255 with SEA at v = 0
        const e = SEA + v * 160;
        elev[i] = Util.clamp(Math.round(e), 0, 255);
      }
    }
    return elev;
  }

  return { generate, SEA };
})();
