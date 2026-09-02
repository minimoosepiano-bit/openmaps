/* Global world state. Everything the game knows about lives here. */
'use strict';

const FLAG_W = 12, FLAG_H = 8;

const State = {
  w: 400, h: 225,
  elev: null,    // Uint8Array – elevation, water below MapGen.SEA
  owner: null,   // Uint16Array – nation id per cell, 0 = unclaimed
  nations: [],   // { id, name, color, flag: string[FLAG_W*FLAG_H], label: bool }
  units: [],     // { id, nation, x, y, angle (rad, facing), size, hp, path:[{x,y}], engaged }
  nextNationId: 1,
  nextUnitId: 1,
  seed: 1,

  /* editor */
  selectedNation: 0,
  selectedUnit: null,
  tool: 'paint',
  brushSize: 4,
  paintWater: false,
  showBorders: true,
  showGrid: false,

  /* simulation */
  playing: true,
  speed: 2,
  tick: 0,

  dirty: true,        // map pixels need re-render
  labelsDirty: true,  // nation centroids need recomputing

  isLand(i) { return this.elev[i] >= MapGen.SEA; },
  idx(x, y) { return y * this.w + x; },
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; },
  nation(id) { return this.nations.find(n => n.id === id) || null; },
  unit(id) { return this.units.find(u => u.id === id) || null; },

  maxHp(size) { return size * 100; },

  /* ---- flags ---- */
  makeFlag(preset, colors, rand) {
    const f = new Array(FLAG_W * FLAG_H);
    const c = colors;
    const set = (x, y, col) => { f[y * FLAG_W + x] = col; };
    for (let y = 0; y < FLAG_H; y++) for (let x = 0; x < FLAG_W; x++) {
      let col;
      switch (preset) {
        case 'tri-h': col = c[Math.min(2, Math.floor(y / (FLAG_H / 3)))]; break;
        case 'tri-v': col = c[Math.min(2, Math.floor(x / (FLAG_W / 3)))]; break;
        case 'bi-h': col = y < FLAG_H / 2 ? c[0] : c[1]; break;
        case 'cross': col = (Math.abs(x - 5.5) < 1.5 || Math.abs(y - 3.5) < 1.5) ? c[1] : c[0]; break;
        case 'nordic': col = ((x === 3 || x === 4) || (y === 3 || y === 4)) ? c[1] : c[0]; break;
        case 'diag': col = (x / FLAG_W + y / FLAG_H < 1) ? c[0] : c[1]; break;
        default: col = c[0];
      }
      set(x, y, col);
    }
    return f;
  },
  randomFlag(baseColor, rand) {
    const presets = ['tri-h', 'tri-v', 'bi-h', 'cross', 'nordic', 'diag'];
    const preset = presets[Math.floor(rand() * presets.length)];
    const [r, g, b] = Util.hexToRgb(baseColor);
    const palette = ['#ffffff', '#111111', '#d92a2a', '#1f4fbf', '#f2c11d', '#1c9c3c', '#ff8c1a', '#6a2fb8'];
    const c2 = palette[Math.floor(rand() * palette.length)];
    let c3 = palette[Math.floor(rand() * palette.length)];
    if (c3 === c2) c3 = '#ffffff';
    const cols = [baseColor, c2, c3];
    // shuffle a little so the base colour is not always the first stripe
    if (rand() < 0.5) { const t = cols[0]; cols[0] = cols[1]; cols[1] = t; }
    return this.makeFlag(preset, cols, rand);
  },

  /* ---- nations ---- */
  addNation(opts = {}) {
    const rand = Util.rng((this.seed * 7919 + this.nextNationId * 104729) >>> 0);
    const hue = (this.nextNationId * 137.508) % 360; // golden-angle hue spread
    const color = opts.color || Util.hslToHex(hue, 55 + rand() * 30, 45 + rand() * 15);
    const n = {
      id: this.nextNationId++,
      name: opts.name || Util.nationName(rand),
      color,
      flag: opts.flag || this.randomFlag(color, rand),
      label: opts.label !== undefined ? opts.label : true,
    };
    this.nations.push(n);
    return n;
  },
  removeNation(id) {
    this.nations = this.nations.filter(n => n.id !== id);
    this.units = this.units.filter(u => u.nation !== id);
    for (let i = 0; i < this.owner.length; i++) if (this.owner[i] === id) this.owner[i] = 0;
    if (this.selectedNation === id) this.selectedNation = this.nations.length ? this.nations[0].id : 0;
    if (this.selectedUnit && !this.unit(this.selectedUnit)) this.selectedUnit = null;
    this.dirty = true; this.labelsDirty = true;
  },

  /* ---- units ---- */
  addUnit(nation, x, y, size = 3) {
    const u = { id: this.nextUnitId++, nation, x, y, angle: 0, size, hp: this.maxHp(size), path: [], engaged: false };
    this.units.push(u);
    return u;
  },
  removeUnit(id) {
    this.units = this.units.filter(u => u.id !== id);
    if (this.selectedUnit === id) this.selectedUnit = null;
  },

  /* ---- world ---- */
  newWorld({ w, h, type, seed, nations }) {
    this.w = w; this.h = h; this.seed = seed;
    this.elev = MapGen.generate(w, h, type, seed);
    this.owner = new Uint16Array(w * h);
    this.nations = []; this.units = [];
    this.nextNationId = 1; this.nextUnitId = 1;
    this.selectedNation = 0; this.selectedUnit = null;
    this.playing = true; this.tick = 0;
    this.dirty = true; this.labelsDirty = true;

    if (nations > 0 && type !== 'blank-water') this.seedNations(nations);
    if (this.nations.length) this.selectedNation = this.nations[0].id;
  },

  /* Scatter nations on land and grow them with a flood-fill "race". */
  seedNations(count) {
    const rand = Util.rng(this.seed ^ 0xABCDEF);
    const land = [];
    for (let i = 0; i < this.owner.length; i++) if (this.isLand(i)) land.push(i);
    if (!land.length) return;
    const frontier = [];
    for (let k = 0; k < count; k++) {
      const n = this.addNation();
      // pick a start far-ish from the others
      let best = -1, bestD = -1;
      for (let t = 0; t < 12; t++) {
        const c = land[Math.floor(rand() * land.length)];
        const cx = c % this.w, cy = (c / this.w) | 0;
        let d = Infinity;
        for (const f of frontier) { const fx = f.i % this.w, fy = (f.i / this.w) | 0; d = Math.min(d, Util.dist(cx, cy, fx, fy)); }
        if (d > bestD) { bestD = d; best = c; }
      }
      this.owner[best] = n.id;
      frontier.push({ i: best, n: n.id });
    }
    // grow: random-order BFS so borders are ragged and organic
    const queue = frontier.map(f => f.i);
    const limit = Math.floor(land.length * 0.65);
    let claimed = queue.length;
    const nb = [1, -1, this.w, -this.w];
    while (queue.length && claimed < limit) {
      const qi = Math.floor(rand() * queue.length);
      const i = queue[qi]; queue[qi] = queue[queue.length - 1]; queue.pop();
      const id = this.owner[i];
      const x = i % this.w;
      for (const d of nb) {
        const j = i + d;
        if (j < 0 || j >= this.owner.length) continue;
        if ((d === 1 && x === this.w - 1) || (d === -1 && x === 0)) continue;
        if (this.owner[j] || !this.isLand(j)) continue;
        if (rand() < 0.15) continue; // skip → raggedness
        this.owner[j] = id; claimed++; queue.push(j);
      }
    }
  },

  /* ---- serialisation ---- */
  serialize(includeHistory) {
    const b64 = Util.b64;
    const data = {
      version: 1, w: this.w, h: this.h, seed: this.seed,
      elev: b64(this.elev), owner: b64(this.owner),
      nations: this.nations, units: this.units,
      nextNationId: this.nextNationId, nextUnitId: this.nextUnitId,
    };
    if (includeHistory) data.history = History.serialize();
    return JSON.stringify(data);
  },
  deserialize(json) {
    const d = JSON.parse(json);
    const bytes = Util.unb64;
    this.w = d.w; this.h = d.h; this.seed = d.seed || 1;
    this.elev = bytes(d.elev);
    this.owner = new Uint16Array(bytes(d.owner).buffer);
    this.nations = d.nations; this.units = d.units;
    this.nextNationId = d.nextNationId; this.nextUnitId = d.nextUnitId;
    this.selectedNation = this.nations.length ? this.nations[0].id : 0;
    this.selectedUnit = null; this.playing = true;
    for (const u of this.units) { if (!u.path) u.path = []; }
    this.dirty = true; this.labelsDirty = true;
    return d;
  },
};
