/* DOM panels: nation list, nation editor + flag editor, unit editor, timeline, dialogs. */
'use strict';

const UI = (() => {
  const $ = Util.$;
  let flagColor = '#d92a2a';
  let flagPainting = false;
  const PALETTE = ['#ffffff', '#111111', '#d92a2a', '#1f4fbf', '#f2c11d', '#1c9c3c', '#ff8c1a', '#6a2fb8', '#8b4513', '#00b5c9', '#ff69b4', '#9aa3b2'];

  function init() {
    // toolbar
    document.querySelectorAll('#toolbar .tool').forEach(b => b.addEventListener('click', () => Tools.setTool(b.dataset.tool)));
    $('brush-size').addEventListener('input', e => { State.brushSize = +e.target.value; refreshBrush(); });

    // top bar
    $('btn-play').addEventListener('click', () => Sim.toggle());
    $('sim-speed').addEventListener('input', e => { State.speed = +e.target.value; $('sim-speed-val').textContent = State.speed + 'x'; });
    $('btn-undo').addEventListener('click', () => History.undo());
    $('btn-new').addEventListener('click', () => $('dlg-new').showModal());
    $('btn-help').addEventListener('click', () => $('dlg-help').showModal());
    $('btn-save').addEventListener('click', save);
    $('btn-load').addEventListener('click', () => $('file-load').click());
    $('file-load').addEventListener('change', load);
    $('btn-png').addEventListener('click', () => Recorder.exportPng());
    $('dlg-new').addEventListener('close', () => { if ($('dlg-new').returnValue === 'ok') Main.newWorldFromDialog(); });

    // nations
    $('btn-add-nation').addEventListener('click', () => {
      History.touch(); const n = State.addNation(); History.commit();
      selectNation(n.id);
      Tools.setTool('paint');
    });
    $('nat-name').addEventListener('input', e => { const n = cur(); if (n) { n.name = e.target.value; nationEdited(); } });
    $('nat-color').addEventListener('input', e => { const n = cur(); if (n) { n.color = e.target.value; State.dirty = true; nationEdited(); } });
    $('nat-label').addEventListener('change', e => { const n = cur(); if (n) { n.label = e.target.checked; nationEdited(); } });
    $('btn-del-nation').addEventListener('click', () => {
      const n = cur(); if (!n) return;
      if (!confirm(`Delete ${n.name}? Its territory becomes unclaimed.`)) return;
      History.begin();
      for (let i = 0; i < State.owner.length; i++) if (State.owner[i] === n.id) History.setOwner(i, 0);
      State.removeNation(n.id);
      History.commit();
      refreshNations();
    });

    // flag editor
    const pal = $('flag-palette');
    PALETTE.forEach(c => {
      const s = document.createElement('span'); s.style.background = c; s.title = c;
      s.addEventListener('click', () => { flagColor = c; pal.querySelectorAll('span').forEach(x => x.classList.toggle('active', x === s)); });
      pal.appendChild(s);
    });
    pal.children[2].classList.add('active');
    const fc = $('flag-canvas');
    const paintFlag = e => {
      const n = cur(); if (!n) return;
      const r = fc.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * FLAG_W), y = Math.floor((e.clientY - r.top) / r.height * FLAG_H);
      if (x < 0 || y < 0 || x >= FLAG_W || y >= FLAG_H) return;
      const col = e.buttons === 2 || e.shiftKey ? n.color : flagColor;
      if (n.flag[y * FLAG_W + x] === col) return;
      n.flag[y * FLAG_W + x] = col; drawFlagEditor(n);
    };
    fc.addEventListener('pointerdown', e => { e.preventDefault(); flagPainting = true; History.touch(); paintFlag(e); });
    fc.addEventListener('pointermove', e => { if (flagPainting) paintFlag(e); });
    window.addEventListener('pointerup', () => { if (flagPainting) { flagPainting = false; nationEdited(); } });
    fc.addEventListener('contextmenu', e => e.preventDefault());
    document.querySelectorAll('.flag-presets button').forEach(b => b.addEventListener('click', () => {
      const n = cur(); if (!n) return;
      History.touch();
      const rand = Util.rng((Date.now() & 0xffff) ^ n.id);
      if (b.dataset.preset === 'random') n.flag = State.randomFlag(n.color, rand);
      else {
        const c2 = PALETTE[Math.floor(rand() * PALETTE.length)];
        const c3 = flagColor;
        n.flag = State.makeFlag(b.dataset.preset, [n.color, c3 === n.color ? c2 : c3, c2 === c3 ? '#ffffff' : c2], rand);
      }
      nationEdited(); drawFlagEditor(n);
    }));

    // unit editor
    $('unit-size').addEventListener('input', e => {
      const u = State.unit(State.selectedUnit); if (!u) return;
      History.touch(); const ratio = u.hp / State.maxHp(u.size); u.size = +e.target.value; u.hp = Math.round(State.maxHp(u.size) * ratio); History.commit(); refreshUnit();
    });
    $('unit-angle').addEventListener('input', e => {
      const u = State.unit(State.selectedUnit); if (!u) return;
      History.touch(); u.angle = (+e.target.value) * Math.PI / 180; History.commit(); refreshUnit();
    });
    $('unit-order').addEventListener('change', e => {
      const u = State.unit(State.selectedUnit); if (!u) return;
      History.touch(); u.order = e.target.value; History.commit();
    });
    $('btn-unit-heal').addEventListener('click', () => {
      const u = State.unit(State.selectedUnit); if (!u) return;
      History.touch(); u.hp = State.maxHp(u.size); History.commit(); refreshUnit();
    });
    $('btn-del-unit').addEventListener('click', () => {
      const u = State.unit(State.selectedUnit); if (!u) return;
      History.touch(); State.removeUnit(u.id); History.commit(); selectUnit(null);
    });

    // world options
    $('opt-paint-water').addEventListener('change', e => { State.paintWater = e.target.checked; });
    $('opt-borders').addEventListener('change', e => { State.showBorders = e.target.checked; State.dirty = true; });
    $('opt-grid').addEventListener('change', e => { State.showGrid = e.target.checked; });

    // timeline
    $('tl-slider').addEventListener('input', e => { Recorder.stop(); if (State.playing) Sim.toggle(); History.seek(+e.target.value); });
    $('tl-start').addEventListener('click', () => { Recorder.stop(); History.seek(0); });
    $('tl-end').addEventListener('click', () => { Recorder.stop(); History.seek(History.length); });
    $('tl-play').addEventListener('click', () => Recorder.toggle());
    $('btn-record').addEventListener('click', () => Recorder.exportVideo(Util.clamp(parseInt($('tl-fps').value) || 20, 1, 60)));

    refreshBrush(); playChanged(); timelapseChanged();
  }

  const cur = () => State.nation(State.selectedNation);

  function nationEdited() {
    History.commit();
    refreshNations();
  }

  function refreshBrush() { $('brush-val').textContent = State.brushSize; $('brush-size').value = State.brushSize; }

  function playChanged() {
    $('btn-play').textContent = State.playing ? '❚❚ PAUSE' : '▶ PLAY';
    $('btn-play').classList.toggle('danger', State.playing);
    $('sim-status').textContent = State.playing ? 'war in progress' : 'paused';
  }
  function timelapseChanged() {
    $('tl-play').textContent = Recorder.playing ? '❚❚' : '▶';
    $('btn-record').disabled = Recorder.recording;
  }
  function timelineChanged() {
    const s = $('tl-slider');
    s.max = History.length; s.value = History.cursor;
    $('tl-label').textContent = `${History.cursor} / ${History.length}`;
    $('btn-undo').disabled = History.cursor === 0;
  }

  /* ---- nations panel ---- */
  function selectNation(id) {
    State.selectedNation = id;
    refreshNations();
  }
  function refreshNations() {
    const list = $('nation-list');
    list.innerHTML = '';
    const counts = State.cellCounts || new Map();
    if (!State.nations.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No nations yet — click + NEW'; list.appendChild(li); }
    for (const n of State.nations) {
      const li = document.createElement('li');
      li.classList.toggle('active', n.id === State.selectedNation);
      const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = n.color;
      const fl = document.createElement('canvas'); fl.width = FLAG_W; fl.height = FLAG_H;
      const fctx = fl.getContext('2d');
      for (let y = 0; y < FLAG_H; y++) for (let x = 0; x < FLAG_W; x++) { fctx.fillStyle = n.flag[y * FLAG_W + x] || '#fff'; fctx.fillRect(x, y, 1, 1); }
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n.name;
      const ct = document.createElement('span'); ct.className = 'ct';
      const c = counts.get(n.id); ct.textContent = c ? (c.n >= 1000 ? (c.n / 1000).toFixed(1) + 'k' : c.n) : '0';
      li.append(sw, fl, nm, ct);
      li.addEventListener('click', () => selectNation(n.id));
      li.addEventListener('dblclick', () => { $('nat-name').focus(); $('nat-name').select(); });
      list.appendChild(li);
    }
    const n = cur();
    $('nation-editor').classList.toggle('hidden', !n);
    if (n) {
      if (document.activeElement !== $('nat-name')) $('nat-name').value = n.name;
      $('nat-color').value = n.color;
      $('nat-label').checked = n.label !== false;
      drawFlagEditor(n);
      const c = counts.get(n.id);
      const units = State.units.filter(u => u.nation === n.id).length;
      $('nat-stats').textContent = `${c ? c.n : 0} cells · ${units} unit${units === 1 ? '' : 's'}`;
    }
  }
  function drawFlagEditor(n) {
    const c = $('flag-canvas').getContext('2d');
    for (let y = 0; y < FLAG_H; y++) for (let x = 0; x < FLAG_W; x++) { c.fillStyle = n.flag[y * FLAG_W + x] || '#fff'; c.fillRect(x, y, 1, 1); }
  }

  /* ---- unit panel ---- */
  function selectUnit(id) { State.selectedUnit = id; refreshUnit(); }
  function refreshUnit() {
    const u = State.unit(State.selectedUnit);
    $('unit-editor').classList.toggle('hidden', !u);
    if (!u) return;
    const n = State.nation(u.nation);
    $('unit-owner').textContent = `Army of ${n ? n.name : '?'}`;
    $('unit-size').value = u.size; $('unit-size-val').textContent = u.size;
    const deg = Math.round(((u.angle * 180 / Math.PI) % 360 + 360) % 360);
    $('unit-angle').value = deg; $('unit-angle-val').textContent = deg + '°';
    $('unit-order').value = u.order;
    $('unit-hp').textContent = `Strength ${Math.max(0, Math.round(u.hp))} / ${State.maxHp(u.size)}${u.engaged ? ' · FIGHTING' : ''}`;
  }

  /* ---- hud ---- */
  let lastHud = '';
  function hover(w) {
    const x = Math.floor(w.x), y = Math.floor(w.y);
    let txt;
    if (!State.inBounds(x, y)) txt = '—';
    else {
      const i = State.idx(x, y);
      const o = State.owner[i]; const n = o ? State.nation(o) : null;
      txt = `${x},${y}  ${State.isLand(i) ? 'land' : 'water'}  ${n ? n.name : o ? '?' : 'unclaimed'}`;
    }
    if (txt !== lastHud) { $('hud').textContent = txt; lastHud = txt; }
  }
  function worldStats() {
    let land = 0, owned = 0;
    for (let i = 0; i < State.owner.length; i++) { if (State.isLand(i)) { land++; if (State.owner[i]) owned++; } }
    $('world-stats').textContent = `${State.w}×${State.h} · ${land} land cells · ${land ? Math.round(owned / land * 100) : 0}% claimed · ${State.units.length} armies · tick ${State.tick}`;
  }

  function toast(msg) {
    const h = $('hud'); h.textContent = msg; lastHud = msg;
    h.style.color = '#f2b134'; setTimeout(() => { h.style.color = ''; }, 1500);
  }

  /* ---- save / load ---- */
  function save() {
    const includeHistory = History.length === 0 || confirm('Include the timelapse history in the save file?\n(OK = yes, larger file; Cancel = map only)');
    const json = State.serialize(includeHistory);
    Util.download('openmaps-scenario.json', new Blob([json], { type: 'application/json' }));
  }
  function load(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { Main.loadScenario(rd.result); toast('Scenario loaded'); }
      catch (err) { console.error(err); toast('Could not load file: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  }

  return { init, refreshNations, selectNation, selectUnit, refreshUnit, refreshBrush, playChanged, timelineChanged, timelapseChanged, hover, worldStats, toast, drawFlagEditor };
})();
