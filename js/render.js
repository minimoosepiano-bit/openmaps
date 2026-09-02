/* Rendering: pixel map → offscreen buffer, then scaled onto the viewport with
   units, labels and editor overlays drawn on top. */
'use strict';

const Render = (() => {
  let canvas, ctx;                // viewport
  let off, offCtx, img, buf32;    // native-resolution map buffer
  const cam = { x: 0, y: 0, zoom: 3 };
  const mouse = { x: -1, y: -1, over: false };
  let labels = [];                // [{id, x, y}]
  let hoverUnit = null;
  let pendingArrow = null;        // arrow being drawn right now [{x,y,nation}, ...]

  const C = {
    deep: [26, 58, 112], shallow: [42, 96, 160], coast: [78, 150, 200],
    lowLand: [122, 158, 92], highLand: [196, 190, 150], peak: [232, 232, 226],
  };

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
  }
  function ensureBuffer() {
    if (off && off.width === State.w && off.height === State.h) return;
    off = document.createElement('canvas'); off.width = State.w; off.height = State.h;
    offCtx = off.getContext('2d');
    img = offCtx.createImageData(State.w, State.h);
    buf32 = new Uint32Array(img.data.buffer);
    State.dirty = true;
  }
  function fit() {
    ensureBuffer();
    const zx = canvas.width / State.w, zy = canvas.height / State.h;
    cam.zoom = Math.max(0.5, Math.min(zx, zy) * 0.95);
    cam.x = (State.w - canvas.width / cam.zoom) / 2;
    cam.y = (State.h - canvas.height / cam.zoom) / 2;
  }

  /* ---- coordinate helpers (screen coords are canvas pixels) ---- */
  const screenToWorld = (sx, sy) => ({ x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y });
  const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom });
  function clientToScreen(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * devicePixelRatio, y: (e.clientY - r.top) * devicePixelRatio };
  }
  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    cam.zoom = Util.clamp(cam.zoom * factor, 0.5, 40);
    const after = screenToWorld(sx, sy);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
  }

  /* ---- map pixels ---- */
  const nationRgb = new Map();
  function colorOf(id) {
    let c = nationRgb.get(id);
    const n = State.nation(id);
    if (!n) return [200, 200, 200];
    if (!c || c.hex !== n.color) { const [r, g, b] = Util.hexToRgb(n.color); c = { hex: n.color, r, g, b }; nationRgb.set(id, c); }
    return [c.r, c.g, c.b];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  function renderMap() {
    ensureBuffer();
    const w = State.w, h = State.h, elev = State.elev, owner = State.owner, SEA = MapGen.SEA;
    const borders = State.showBorders;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, e = elev[i];
        let r, g, b;
        if (e < SEA) {
          // water: depth shading + coastline highlight
          const nearLand = (x > 0 && elev[i - 1] >= SEA) || (x < w - 1 && elev[i + 1] >= SEA) || (y > 0 && elev[i - w] >= SEA) || (y < h - 1 && elev[i + w] >= SEA);
          let c;
          if (nearLand) c = C.coast;
          else c = mix(C.deep, C.shallow, e / SEA);
          // subtle dither texture
          const d = ((x * 7 + y * 13) % 5 === 0) ? 4 : 0;
          r = c[0] + d; g = c[1] + d; b = c[2] + d;
        } else {
          const t = (e - SEA) / (255 - SEA);
          let c = t < 0.6 ? mix(C.lowLand, C.highLand, t / 0.6) : mix(C.highLand, C.peak, (t - 0.6) / 0.4);
          const o = owner[i];
          if (o) {
            const nc = colorOf(o);
            c = mix(c, nc, 0.78);
            if (borders) {
              // 1px border on this cell if the land neighbour to the left or above belongs to someone else
              const l = x > 0 && elev[i - 1] >= SEA && owner[i - 1] !== o;
              const u = y > 0 && elev[i - w] >= SEA && owner[i - w] !== o;
              const rr = x < w - 1 && elev[i + 1] >= SEA && owner[i + 1] !== o && owner[i + 1] === 0;
              const dd = y < h - 1 && elev[i + w] >= SEA && owner[i + w] !== o && owner[i + w] === 0;
              if (l || u || rr || dd) c = mix(c, [0, 0, 0], 0.55);
            }
          } else {
            const d = ((x * 3 + y * 5) % 7 === 0) ? -6 : 0;
            c = [c[0] + d, c[1] + d, c[2] + d];
          }
          r = c[0]; g = c[1]; b = c[2];
        }
        buf32[i] = Util.packRgb(r | 0, g | 0, b | 0);
      }
    }
    offCtx.putImageData(img, 0, 0);
    State.dirty = false;
  }

  function computeLabels() {
    const acc = new Map();
    const w = State.w, owner = State.owner;
    for (let i = 0; i < owner.length; i++) {
      const o = owner[i]; if (!o) continue;
      let a = acc.get(o); if (!a) { a = { n: 0, x: 0, y: 0 }; acc.set(o, a); }
      a.n++; a.x += i % w; a.y += (i / w) | 0;
    }
    labels = [];
    for (const [id, a] of acc) {
      if (a.n < 12) continue;
      let cx = a.x / a.n, cy = a.y / a.n;
      // if the centroid is not inside the nation (e.g. crescent shape), pull it to the nearest owned cell
      const ci = State.idx(Math.round(cx), Math.round(cy));
      if (owner[ci] !== id) {
        let best = Infinity, bx = cx, by = cy;
        for (let i = 0; i < owner.length; i += 3) {
          if (owner[i] !== id) continue;
          const x = i % w, y = (i / w) | 0, d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < best) { best = d; bx = x; by = y; }
        }
        cx = bx; cy = by;
      }
      labels.push({ id, x: cx, y: cy, n: a.n });
    }
    State.cellCounts = acc;
    State.labelsDirty = false;
  }

  /* Draw a flag (array of colours) at screen position with pixel size px. */
  function drawFlag(c, flag, sx, sy, px) {
    for (let y = 0; y < FLAG_H; y++) for (let x = 0; x < FLAG_W; x++) {
      c.fillStyle = flag[y * FLAG_W + x] || '#ffffff';
      c.fillRect(sx + x * px, sy + y * px, px, px);
    }
    c.strokeStyle = '#000'; c.lineWidth = Math.max(1, px * 0.6);
    c.strokeRect(sx, sy, FLAG_W * px, FLAG_H * px);
  }

  function unitRadius(u) { return 1.6 + u.size * 0.55; } // world units

  function drawUnit(c, u, zoom, selected, hovered) {
    const n = State.nation(u.nation);
    const col = n ? n.color : '#999';
    const r = unitRadius(u) * zoom;
    c.save();
    c.translate(0, 0);
    // body
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = col; c.fill();
    c.lineWidth = Math.max(1.5, zoom * 0.5); c.strokeStyle = u.engaged ? '#ff3b3b' : '#000'; c.stroke();
    // heading arrow
    c.rotate(u.angle);
    c.beginPath();
    c.moveTo(r * 1.9, 0); c.lineTo(r * 0.4, -r * 0.75); c.lineTo(r * 0.4, r * 0.75); c.closePath();
    c.fillStyle = Util.luminance(col) > 0.6 ? '#000' : '#fff'; c.fill();
    c.strokeStyle = '#000'; c.lineWidth = Math.max(1, zoom * 0.3); c.stroke();
    c.rotate(-u.angle);
    // hp bar
    const hpw = r * 2.4, hp = u.hp / State.maxHp(u.size);
    c.fillStyle = '#000'; c.fillRect(-hpw / 2 - 1, r + 3, hpw + 2, Math.max(3, zoom * 0.9) + 2);
    c.fillStyle = hp > 0.5 ? '#3ddc5a' : hp > 0.25 ? '#f2b134' : '#e0563b';
    c.fillRect(-hpw / 2, r + 4, hpw * hp, Math.max(3, zoom * 0.9));
    // size digit
    c.font = `bold ${Math.max(9, r * 0.9)}px ${'"Courier New",monospace'}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = Util.luminance(col) > 0.6 ? '#000' : '#fff';
    c.fillText(String(u.size), 0, 0);
    if (selected || hovered) {
      c.beginPath(); c.arc(0, 0, r * 1.6, 0, Math.PI * 2);
      c.strokeStyle = selected ? '#4fa3ff' : 'rgba(255,255,255,.6)'; c.lineWidth = 2;
      c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
    }
    c.restore();
  }

  /* Movement arrow: from the unit through its waypoints, with an arrowhead at the end. */
  function drawArrow(c, color, pts, camX, camY, zoom, alpha) {
    if (pts.length < 2) return;
    const P = pts.map(p => [(p.x - camX) * zoom, (p.y - camY) * zoom]);
    c.save();
    c.globalAlpha = alpha;
    c.lineCap = 'round'; c.lineJoin = 'round';
    const w = Math.max(2, zoom * 1.1);
    for (const [style, lw] of [['rgba(0,0,0,.8)', w + 3], [color, w]]) {
      c.strokeStyle = style; c.lineWidth = lw; c.beginPath();
      c.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]);
      c.stroke();
    }
    // arrowhead
    const [ex, ey] = P[P.length - 1];
    let k = P.length - 2;
    while (k > 0 && Math.hypot(ex - P[k][0], ey - P[k][1]) < w * 2) k--;
    const a = Math.atan2(ey - P[k][1], ex - P[k][0]);
    const hs = Math.max(8, zoom * 3.2);
    c.beginPath();
    c.moveTo(ex + Math.cos(a) * hs * 0.6, ey + Math.sin(a) * hs * 0.6);
    c.lineTo(ex + Math.cos(a + 2.5) * hs, ey + Math.sin(a + 2.5) * hs);
    c.lineTo(ex + Math.cos(a - 2.5) * hs, ey + Math.sin(a - 2.5) * hs);
    c.closePath();
    c.fillStyle = color; c.fill();
    c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 2; c.stroke();
    c.restore();
  }

  /* Draw the whole scene into an arbitrary context (used for the viewport, PNG and video). */
  function drawScene(c, camX, camY, zoom, width, height, overlays) {
    if (State.dirty) renderMap();
    if (State.labelsDirty) computeLabels();
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0b0d12'; c.fillRect(0, 0, width, height);
    c.save();
    c.scale(zoom, zoom); c.translate(-camX, -camY);
    c.drawImage(off, 0, 0);
    c.restore();

    if (State.showGrid && zoom >= 6 && overlays) {
      c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 1; c.beginPath();
      const x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(State.w, Math.ceil(camX + width / zoom));
      const y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(State.h, Math.ceil(camY + height / zoom));
      for (let x = x0; x <= x1; x++) { const s = (x - camX) * zoom; c.moveTo(s, (y0 - camY) * zoom); c.lineTo(s, (y1 - camY) * zoom); }
      for (let y = y0; y <= y1; y++) { const s = (y - camY) * zoom; c.moveTo((x0 - camX) * zoom, s); c.lineTo((x1 - camX) * zoom, s); }
      c.stroke();
    }

    // labels
    const fontPx = Util.clamp(zoom * 2.6, 9, 26);
    c.font = `bold ${fontPx}px "Courier New", monospace`;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (const l of labels) {
      const n = State.nation(l.id); if (!n || !n.label) continue;
      const sx = (l.x - camX) * zoom, sy = (l.y - camY) * zoom;
      if (sx < -100 || sy < -60 || sx > width + 100 || sy > height + 60) continue;
      const px = Math.max(1, Math.round(fontPx / 8));
      drawFlag(c, n.flag, sx - FLAG_W * px / 2, sy - FLAG_H * px - fontPx * 0.7, px);
      c.lineWidth = Math.max(2, fontPx / 4); c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineJoin = 'round';
      c.strokeText(n.name, sx, sy - fontPx * 0.55);
      c.fillStyle = '#fff'; c.fillText(n.name, sx, sy - fontPx * 0.55);
    }

    // movement arrows
    for (const u of State.units) {
      if (!u.path.length) continue;
      const n = State.nation(u.nation);
      drawArrow(c, n ? n.color : '#fff', [{ x: u.x, y: u.y }, ...u.path], camX, camY, zoom, 0.85);
    }
    for (const a of State.arrows) {
      const n = State.nation(a.nation);
      const col = n ? n.color : '#fff';
      drawArrow(c, col, [{ x: a.x, y: a.y }, ...a.path], camX, camY, zoom, 0.9);
      // front marker (red ring while fighting) + strength bar
      const sx = (a.x - camX) * zoom, sy = (a.y - camY) * zoom;
      const mr = Math.max(3, zoom * 1.1);
      c.beginPath(); c.arc(sx, sy, mr, 0, Math.PI * 2);
      c.fillStyle = col; c.fill(); c.strokeStyle = a.engaged ? '#ff3b3b' : '#000'; c.lineWidth = a.engaged ? 2.5 : 1.5; c.stroke();
      if (a.engaged || a.hp < State.maxHp(a.size)) {
        const hpw = mr * 4, hp = Math.max(0, a.hp / State.maxHp(a.size));
        c.fillStyle = '#000'; c.fillRect(sx - hpw / 2 - 1, sy + mr + 3, hpw + 2, 5);
        c.fillStyle = hp > 0.5 ? '#3ddc5a' : hp > 0.25 ? '#f2b134' : '#e0563b';
        c.fillRect(sx - hpw / 2, sy + mr + 4, hpw * hp, 3);
      }
    }
    if (overlays && pendingArrow && pendingArrow.length > 1) {
      const n = State.nation(pendingArrow[0].nation);
      drawArrow(c, n ? n.color : '#fff', pendingArrow, camX, camY, zoom, 0.6);
    }

    // units
    for (const u of State.units) {
      const sx = (u.x - camX) * zoom, sy = (u.y - camY) * zoom;
      c.save(); c.translate(sx, sy);
      drawUnit(c, u, zoom, overlays && u.id === State.selectedUnit, overlays && hoverUnit === u.id);
      c.restore();
    }
  }

  function draw() {
    drawScene(ctx, cam.x, cam.y, cam.zoom, canvas.width, canvas.height, true);
    // brush preview
    const brushTools = ['paint', 'erase', 'land', 'water'];
    if (mouse.over && brushTools.includes(State.tool)) {
      const w = screenToWorld(mouse.x, mouse.y);
      const cx = (Math.floor(w.x) + 0.5 - cam.x) * cam.zoom, cy = (Math.floor(w.y) + 0.5 - cam.y) * cam.zoom;
      ctx.beginPath(); ctx.arc(cx, cy, State.brushSize * cam.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(cx, cy, State.brushSize * cam.zoom + 1.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (mouse.over && State.tool === 'unit') {
      const w = screenToWorld(mouse.x, mouse.y);
      const s = worldToScreen(w.x, w.y);
      ctx.save(); ctx.translate(s.x, s.y); ctx.globalAlpha = 0.5;
      drawUnit(ctx, { nation: State.selectedNation, x: 0, y: 0, angle: 0, size: 3, hp: 300, path: [] }, cam.zoom, false, false);
      ctx.restore();
    }
  }

  /* Render the full map into a fresh canvas of the given scale. */
  function renderFull(scale) {
    const cv = document.createElement('canvas');
    cv.width = State.w * scale; cv.height = State.h * scale;
    const c = cv.getContext('2d');
    drawScene(c, 0, 0, scale, cv.width, cv.height, false);
    return cv;
  }

  function unitAt(wx, wy) {
    let best = null, bd = Infinity;
    for (const u of State.units) {
      const d = Util.dist(wx, wy, u.x, u.y);
      if (d <= unitRadius(u) * 1.2 && d < bd) { bd = d; best = u; }
    }
    return best;
  }

  return {
    init, fit, draw, resize, renderFull, screenToWorld, worldToScreen, clientToScreen, zoomAt, unitAt, unitRadius,
    cam, mouse, drawFlag,
    set hoverUnit(v) { hoverUnit = v; },
    set pendingArrow(v) { pendingArrow = v; },
    get labels() { return labels; },
  };
})();
