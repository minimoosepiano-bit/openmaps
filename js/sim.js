/* War simulation. Units advance along their heading, claim land in front of them,
   and fight enemy units that get close. */
'use strict';

const Sim = (() => {
  const TICK_MS = 100;
  const SPEED = 0.55;          // cells per tick at 1x
  let acc = 0;

  function update(dt) {
    if (!State.playing) return;
    acc += dt * State.speed;
    let steps = 0;
    while (acc >= TICK_MS && steps < 8) { acc -= TICK_MS; step(); steps++; }
  }

  function step() {
    if (!State.units.length) return;
    History.begin();
    const units = State.units;
    const range = u => Render.unitRadius(u) + 2;

    // 1. engagements: find the closest enemy within contact range for each unit
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

    // 2. combat: damage proportional to the attacker's size and health
    for (const u of units) {
      const foes = enemies.get(u.id); if (!foes) continue;
      const strength = u.size * (0.5 + 0.5 * u.hp / State.maxHp(u.size));
      for (const f of foes) f.hp -= (strength * (0.7 + Math.random() * 0.6) * 2.2) / foes.length;
    }
    for (let i = units.length - 1; i >= 0; i--) if (units[i].hp <= 0) State.removeUnit(units[i].id);

    // 3. movement + capture
    for (const u of units) {
      if (u.hp <= 0) continue;
      const fx = Math.cos(u.angle), fy = Math.sin(u.angle);
      if (!u.engaged && u.order === 'advance') {
        const nx = u.x + fx * SPEED, ny = u.y + fy * SPEED;
        const ci = State.idx(Util.clamp(Math.round(nx), 0, State.w - 1), Util.clamp(Math.round(ny), 0, State.h - 1));
        const blocked = !State.inBounds(Math.round(nx), Math.round(ny)) || !State.isLand(ci);
        if (!blocked) {
          // do not walk straight through a stronger enemy front: stop if an enemy unit is directly ahead
          u.x = nx; u.y = ny;
        }
      }
      capture(u, fx, fy);
    }
    State.tick++;
    History.commit();
  }

  /* Claim land in a half-disc ahead of the unit (plus a small ring around it). */
  function capture(u, fx, fy) {
    const R = Math.ceil(Render.unitRadius(u) + 1.5);
    const cx = Math.round(u.x), cy = Math.round(u.y);
    const id = u.nation;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const dot = dx * fx + dy * fy;
        // half-disc in front, small full disc around the body
        if (dot < -0.5 && d2 > 4) continue;
        const x = cx + dx, y = cy + dy;
        if (!State.inBounds(x, y)) continue;
        const i = State.idx(x, y);
        if (!State.isLand(i)) continue;
        if (State.owner[i] === id) continue;
        // enemy territory defended by an engaged enemy unit is harder to take
        if (State.owner[i] && u.engaged && Math.random() < 0.6) continue;
        History.setOwner(i, id);
      }
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
