/* Pointer handling for the map canvas: brushes, unit placement, drag / rotate, camera. */
'use strict';

const Tools = (() => {
  let canvas;
  let drag = null;        // { kind: 'paint'|'pan'|'unit'|'rotate', ... }
  let spaceHeld = false;
  let lastPaint = null;

  function init(cv) {
    canvas = cv;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', () => { Render.mouse.over = false; });
    canvas.addEventListener('pointerenter', () => { Render.mouse.over = true; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) { spaceHeld = true; } });
    window.addEventListener('keyup', e => { if (e.code === 'Space') spaceHeld = false; });
  }
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'); }

  function setTool(t) {
    State.tool = t;
    document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  }

  /* ---- brush application ---- */
  function applyBrush(wx, wy) {
    const r = State.brushSize, cx = Math.floor(wx), cy = Math.floor(wy);
    const tool = State.tool, sel = State.selectedNation;
    if (tool === 'paint' && !sel) return;
    const r2 = (r - 0.5) * (r - 0.5);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2 && r > 1) continue;
      const x = cx + dx, y = cy + dy;
      if (!State.inBounds(x, y)) continue;
      const i = State.idx(x, y);
      switch (tool) {
        case 'paint':
          if (State.isLand(i) || State.paintWater) History.setOwner(i, sel);
          break;
        case 'erase': History.setOwner(i, 0); break;
        case 'land': History.setElev(i, Math.max(State.elev[i], MapGen.SEA + 30)); break;
        case 'water': History.setElev(i, Math.min(State.elev[i], MapGen.SEA - 30)); History.setOwner(i, 0); break;
      }
    }
  }
  /* Bresenham-ish interpolation so fast strokes stay continuous. */
  function strokeTo(wx, wy) {
    if (!lastPaint) { applyBrush(wx, wy); lastPaint = { x: wx, y: wy }; return; }
    const d = Util.dist(lastPaint.x, lastPaint.y, wx, wy);
    const steps = Math.max(1, Math.ceil(d / Math.max(1, State.brushSize * 0.5)));
    for (let s = 1; s <= steps; s++) applyBrush(Util.lerp(lastPaint.x, wx, s / steps), Util.lerp(lastPaint.y, wy, s / steps));
    lastPaint = { x: wx, y: wy };
  }

  function floodFill(wx, wy) {
    const x = Math.floor(wx), y = Math.floor(wy);
    if (!State.inBounds(x, y)) return;
    const start = State.idx(x, y);
    const target = State.owner[start], repl = State.selectedNation;
    if (target === repl) return;
    const startLand = State.isLand(start);
    if (!startLand && !State.paintWater) return;
    const w = State.w, seen = new Uint8Array(State.owner.length);
    const stack = [start]; seen[start] = 1;
    let count = 0;
    while (stack.length) {
      const i = stack.pop();
      if (State.owner[i] !== target || State.isLand(i) !== startLand) continue;
      History.setOwner(i, repl); count++;
      const cx = i % w;
      const push = j => { if (!seen[j]) { seen[j] = 1; stack.push(j); } };
      if (cx > 0) push(i - 1);
      if (cx < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i + w < State.owner.length) push(i + w);
    }
  }

  /* ---- events ---- */
  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    const s = Render.clientToScreen(e);
    const w = Render.screenToWorld(s.x, s.y);
    const tool = State.tool;

    if (e.button === 1 || spaceHeld || tool === 'pan') {
      drag = { kind: 'pan', sx: s.x, sy: s.y, cx: Render.cam.x, cy: Render.cam.y };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) { // right-click: clear a unit's arrow, otherwise quick-pick nation
      const hitU = Render.unitAt(w.x, w.y);
      if (hitU) { if (hitU.path.length) { History.touch(); hitU.path = []; History.commit(); } UI.selectUnit(hitU.id); return; }
      const i = State.idx(Math.floor(w.x), Math.floor(w.y));
      if (State.inBounds(Math.floor(w.x), Math.floor(w.y)) && State.owner[i]) UI.selectNation(State.owner[i]);
      return;
    }

    // unit interactions are available in the select and unit tools
    if (tool === 'select' || tool === 'unit') {
      const hit = Render.unitAt(w.x, w.y);
      if (hit) {
        UI.selectUnit(hit.id);
        if (e.shiftKey) {
          // shift-drag: relocate the unit without capturing anything
          History.touch();
          drag = { kind: 'unit', unit: hit, ox: hit.x - w.x, oy: hit.y - w.y };
        } else {
          // plain drag: draw a movement arrow
          drag = { kind: 'arrow', unit: hit, pts: [{ x: hit.x, y: hit.y, nation: hit.nation }], dist: 0 };
        }
        return;
      }
      if (tool === 'unit') {
        if (!State.selectedNation) { UI.toast('Select or create a nation first'); return; }
        const x = Math.floor(w.x), y = Math.floor(w.y);
        if (!State.inBounds(x, y)) return;
        History.touch();
        const u = State.addUnit(State.selectedNation, w.x, w.y, 3);
        History.commit();
        UI.selectUnit(u.id);
        UI.toast('Drag from the army to draw its arrow');
        return;
      }
      UI.selectUnit(null);
      return;
    }

    if (tool === 'picker') {
      const x = Math.floor(w.x), y = Math.floor(w.y);
      if (State.inBounds(x, y)) { const o = State.owner[State.idx(x, y)]; if (o) UI.selectNation(o); }
      return;
    }
    if (tool === 'fill') {
      if (!State.selectedNation) { UI.toast('Select or create a nation first'); return; }
      History.begin(); floodFill(w.x, w.y); History.commit();
      return;
    }
    if (tool === 'paint' && !State.selectedNation) { UI.toast('Select or create a nation first'); return; }
    // brushes
    History.begin();
    lastPaint = null;
    drag = { kind: 'paint' };
    strokeTo(w.x, w.y);
  }

  function onMove(e) {
    const s = Render.clientToScreen(e);
    Render.mouse.x = s.x; Render.mouse.y = s.y; Render.mouse.over = true;
    const w = Render.screenToWorld(s.x, s.y);
    UI.hover(w);
    if (!drag) {
      if (State.tool === 'select' || State.tool === 'unit') {
        const hit = Render.unitAt(w.x, w.y);
        Render.hoverUnit = hit ? hit.id : null;
        canvas.style.cursor = hit ? 'move' : (State.tool === 'select' ? 'default' : 'crosshair');
      }
      return;
    }
    switch (drag.kind) {
      case 'pan':
        Render.cam.x = drag.cx - (s.x - drag.sx) / Render.cam.zoom;
        Render.cam.y = drag.cy - (s.y - drag.sy) / Render.cam.zoom;
        break;
      case 'paint': strokeTo(w.x, w.y); break;
      case 'unit': {
        const u = drag.unit;
        u.x = Util.clamp(w.x + drag.ox, 0, State.w - 1); u.y = Util.clamp(w.y + drag.oy, 0, State.h - 1);
        break;
      }
      case 'arrow': {
        const last = drag.pts[drag.pts.length - 1];
        const px = Util.clamp(w.x, 0, State.w - 1), py = Util.clamp(w.y, 0, State.h - 1);
        const d = Util.dist(last.x, last.y, px, py);
        drag.dist += d;
        // keep a waypoint every ~2 cells so the arrow follows the drawn curve
        if (d >= 2) drag.pts.push({ x: px, y: py });
        Render.pendingArrow = drag.dist > 1.5 ? [...drag.pts, { x: px, y: py }] : null;
        break;
      }
    }
  }

  function onUp(e) {
    if (!drag) return;
    if (drag.kind === 'arrow') {
      Render.pendingArrow = null;
      if (drag.dist > 1.5) {
        const s = Render.clientToScreen(e); const w = Render.screenToWorld(s.x, s.y);
        const end = { x: Util.clamp(w.x, 0, State.w - 1), y: Util.clamp(w.y, 0, State.h - 1) };
        const pts = drag.pts.slice(1).map(p => ({ x: p.x, y: p.y }));
        if (!pts.length || Util.dist(pts[pts.length - 1].x, pts[pts.length - 1].y, end.x, end.y) > 0.5) pts.push(end);
        History.touch();
        drag.unit.path = pts;
        drag.unit.angle = Math.atan2(pts[0].y - drag.unit.y, pts[0].x - drag.unit.x);
        History.commit();
        UI.refreshUnit();
        if (!State.playing) UI.toast('Arrow set — press PLAY to move');
      }
    }
    if (drag.kind === 'paint' || drag.kind === 'unit') History.commit();
    if (drag.kind === 'pan') canvas.style.cursor = State.tool === 'pan' ? 'grab' : 'crosshair';
    drag = null; lastPaint = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const s = Render.clientToScreen(e);
    if (e.ctrlKey || e.altKey) {
      State.brushSize = Util.clamp(State.brushSize + (e.deltaY < 0 ? 1 : -1), 1, 30); UI.refreshBrush(); return;
    }
    Render.zoomAt(s.x, s.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function clearOrders(id) {
    const u = State.unit(id); if (!u || !u.path.length) return;
    History.touch(); u.path = []; History.commit(); UI.refreshUnit();
  }

  return { init, setTool, clearOrders, get dragging() { return !!drag; } };
})();
