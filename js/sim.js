/* War simulation. Units follow the arrows drawn for them and convert the territory
   they pass through. Enemy units that meet stop and fight until one is destroyed. */
'use strict';

const Sim = (() => {
  const TICK_MS = 100;
  const SPEED = 0.6;            // cells per tick at 1x
  let acc = 0;

  function update(dt) {
    if (!State.playing) return;
    acc += dt * State.speed;
    let steps = 0;
    while (acc >= TICK_MS && steps < 8) { acc -= TICK_MS; step(); steps++; }
  }

  function step() {
    const units = State.units;
    const active = State.arrows.length || units.some(u => u.path.length || u.engaged);
    if (!active) return;
    History.begin();
    const range = u => Render.unitRadius(u) + 1.5;

    // 1. contact: enemy units within reach of each other are engaged
    for (const u of units) u.engaged = false;
    const enemies = new Map();
    for (let a = 0; a < units.length; a++) {
      const ua = units[a];
      for (let b = a + 1; b < units.length; b++) {
        const ub = units[b];
        if (ua.nation === ub.nation) continue;
        const d = Util.dist(ua.x, ua.y, ub.x, ub.y);
        if (d <= range(ua) + range(ub)) {
          ua.engaged = ub.engaged = true;
          if (!enemies.has(ua.id)) enemies.set(ua.id, []); enemies.get(ua.id).push(ub);
          if (!enemies.has(ub.id)) enemies.set(ub.id, []); enemies.get(ub.id).push(ua);
        }
      }
    }

    // 2. combat: damage proportional to the attacker's size and remaining strength
    for (const u of units) {
      const foes = enemies.get(u.id); if (!foes) continue;
      const strength = u.size * (0.5 + 0.5 * u.hp / State.maxHp(u.size));
      for (const f of foes) f.hp -= (strength * (0.7 + Math.random() * 0.6) * 2.2) / foes.length;
    }
    for (let i = units.length - 1; i >= 0; i--) if (units[i].hp <= 0) State.removeUnit(units[i].id);

    // 3. movement along the arrow + capture
    for (const u of units) {
      if (u.engaged) { capture(u, 0.4); continue; }
      if (!u.path.length) continue;
      let remaining = SPEED;
      while (remaining > 0 && u.path.length) {
        const t = u.path[0];
        const d = Util.dist(u.x, u.y, t.x, t.y);
        if (d <= remaining) { u.x = t.x; u.y = t.y; remaining -= d; u.path.shift(); continue; }
        u.angle = Math.atan2(t.y - u.y, t.x - u.x);
        u.x += Math.cos(u.angle) * remaining; u.y += Math.sin(u.angle) * remaining;
        remaining = 0;
      }
      u.x = Util.clamp(u.x, 0, State.w - 1); u.y = Util.clamp(u.y, 0, State.h - 1);
      capture(u, 1);
      fillGaps(u.x, u.y, Math.ceil(Render.unitRadius(u) + 1), u.nation);
    }

    // 4. free arrows: an advancing front with no unit behind it
    for (const a of State.arrows) {
      advance(a, SPEED * 1.4);
      captureDisc(a.x, a.y, a.size, a.nation, 1);
      fillGaps(a.x, a.y, a.size, a.nation);
      if (!a.path.length) State.removeArrow(a.id);
    }
    State.tick++;
    History.commit();
  }

  /* Move a thing with {x, y, path, angle?} along its path by `dist` cells. */
  function advance(o, dist) {
    let remaining = dist;
    while (remaining > 0 && o.path.length) {
      const t = o.path[0];
      const d = Util.dist(o.x, o.y, t.x, t.y);
      if (d <= remaining) { o.x = t.x; o.y = t.y; remaining -= d; o.path.shift(); continue; }
      const ang = Math.atan2(t.y - o.y, t.x - o.x);
      o.angle = ang;
      o.x += Math.cos(ang) * remaining; o.y += Math.sin(ang) * remaining;
      remaining = 0;
    }
    o.x = Util.clamp(o.x, 0, State.w - 1); o.y = Util.clamp(o.y, 0, State.h - 1);
  }

  /* Convert the land around the unit to its nation. */
  function capture(u, strength) { captureDisc(u.x, u.y, Math.ceil(Render.unitRadius(u) + 1), u.nation, strength); }

  function captureDisc(ux, uy, R, id, strength) {
    const cx = Math.round(ux), cy = Math.round(uy);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R + 0.5) continue;
        const x = cx + dx, y = cy + dy;
        if (!State.inBounds(x, y)) continue;
        const i = State.idx(x, y);
        if (!State.isLand(i) || State.owner[i] === id) continue;
        if (strength < 1 && Math.random() > strength) continue;
        History.setOwner(i, id);
      }
    }
  }

  /* Automatically fill gaps left between arrows.
     1. Morphological closing around the front: any foreign land that lies within G cells of
        our territory on more than one side (a sliver between two swaths, or between a swath
        and our old border) becomes ours.
     2. Pocket fill: a region of foreign land that is completely enclosed by our land is
        absorbed. */
  function fillGaps(fx, fy, R, id) {
    const w = State.w, h = State.h, owner = State.owner;
    const G = Math.max(3, Math.ceil(R * 1.2) + 1);      // half the widest gap we close
    const W = R + G * 2 + 1;                            // window half-size
    const cx = Math.round(fx), cy = Math.round(fy);
    const x0 = Math.max(0, cx - W), y0 = Math.max(0, cy - W);
    const x1 = Math.min(w - 1, cx + W), y1 = Math.min(h - 1, cy + W);
    const ww = x1 - x0 + 1, wh = y1 - y0 + 1;
    const own = new Uint8Array(ww * wh), dil = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) own[y * ww + x] = owner[(y0 + y) * w + x0 + x] === id ? 1 : 0;
    // disc offsets
    const disc = [];
    for (let dy = -G; dy <= G; dy++) for (let dx = -G; dx <= G; dx++) if (dx * dx + dy * dy <= G * G) disc.push(dx, dy);
    // dilate
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      if (!own[y * ww + x]) continue;
      for (let k = 0; k < disc.length; k += 2) {
        const xx = x + disc[k], yy = y + disc[k + 1];
        if (xx >= 0 && yy >= 0 && xx < ww && yy < wh) dil[yy * ww + xx] = 1;
      }
    }
    // erode (cells outside the window count as not dilated → conservative at the edges)
    const changed = [];
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const li = y * ww + x;
      if (own[li] || !dil[li]) continue;
      const gi = (y0 + y) * w + x0 + x;
      if (!State.isLand(gi)) continue;
      let inside = true;
      for (let k = 0; k < disc.length && inside; k += 2) {
        const xx = x + disc[k], yy = y + disc[k + 1];
        if (xx < 0 || yy < 0 || xx >= ww || yy >= wh || !dil[yy * ww + xx]) inside = false;
      }
      if (inside) changed.push(gi);
    }
    for (const gi of changed) History.setOwner(gi, id);

    // pocket fill: flood foreign land touching our front; absorb it if it never reaches
    // water, the map edge, or too far away
    const MAX = 6000;
    const seen = new Set();
    const seeds = [];
    for (let dy = -R - 1; dy <= R + 1; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!State.inBounds(x, y)) continue;
      const i = y * w + x;
      if (owner[i] !== id && State.isLand(i)) seeds.push(i);
    }
    for (const s of seeds) {
      if (seen.has(s)) continue;
      const region = [], stack = [s]; seen.add(s);
      let open = false;
      while (stack.length && !open) {
        const i = stack.pop(); region.push(i);
        if (region.length > MAX) { open = true; break; }
        const x = i % w, y = (i / w) | 0;
        const nbs = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { open = true; break; }
          const j = ny * w + nx;
          if (owner[j] === id) continue;
          if (!State.isLand(j)) { open = true; break; }
          if (!seen.has(j)) { seen.add(j); stack.push(j); }
        }
      }
      if (!open) for (const i of region) History.setOwner(i, id);
    }
  }

  function toggle() {
    State.playing = !State.playing;
    if (State.playing && !History.atHead) History.seek(History.length);
    acc = 0;
    UI.playChanged();
  }

  return { update, step, toggle };
})();
