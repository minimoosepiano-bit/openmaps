/* Bootstrap, game loop and keyboard shortcuts. */
'use strict';

const Main = (() => {
  let last = 0, statsTimer = 0;

  function newWorld(opts) {
    State.newWorld(opts);
    History.reset();
    Render.fit();
    UI.selectUnit(null);
    UI.refreshNations();
    UI.worldStats();
  }

  function newWorldFromDialog() {
    const [w, h] = Util.$('new-size').value.split('x').map(Number);
    const seedTxt = Util.$('new-seed').value.trim();
    const seed = seedTxt ? (Number.isInteger(+seedTxt) ? +seedTxt >>> 0 : Util.hashString(seedTxt)) : (Math.random() * 2 ** 32) >>> 0;
    newWorld({ w, h, type: Util.$('new-type').value, seed, nations: Util.clamp(parseInt(Util.$('new-nations').value) || 0, 0, 40) });
  }

  function loadScenario(json) {
    const d = State.deserialize(json);
    if (d.history) History.deserialize(d.history); else History.reset();
    Render.fit();
    UI.selectUnit(null); UI.refreshNations(); UI.worldStats();
  }

  function loop(t) {
    const dt = Math.min(100, t - last); last = t;
    Sim.update(dt);
    Recorder.update(dt);
    Render.draw();
    statsTimer += dt;
    if (statsTimer > 500) {
      statsTimer = 0; UI.worldStats();
      if (State.selectedUnit) UI.refreshUnit();
      if (State.playing) UI.refreshNations();
    }
    requestAnimationFrame(loop);
  }

  function keys(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); History.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); Util.$('btn-save').click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { b: 'paint', e: 'erase', g: 'fill', i: 'picker', l: 'land', w: 'water', u: 'unit', v: 'select', h: 'pan' };
    const k = e.key.toLowerCase();
    if (k === 'q') { Tools.rotateSelected(-Math.PI / 12); return; }
    if (k === 'e' && e.shiftKey) { Tools.rotateSelected(Math.PI / 12); return; }
    if (map[k] && !e.shiftKey) { Tools.setTool(map[k]); return; }
    switch (e.key) {
      case ' ': e.preventDefault(); if (!e.repeat) Sim.toggle(); break;
      case '[': State.brushSize = Math.max(1, State.brushSize - 1); UI.refreshBrush(); break;
      case ']': State.brushSize = Math.min(30, State.brushSize + 1); UI.refreshBrush(); break;
      case 'Delete': case 'Backspace': if (State.selectedUnit) Util.$('btn-del-unit').click(); break;
      case 'f': Render.fit(); break;
      case '?': Util.$('dlg-help').showModal(); break;
    }
  }

  function init() {
    const canvas = Util.$('map');
    Render.init(canvas);
    Tools.init(canvas);
    UI.init();
    window.addEventListener('keydown', keys);
    window.addEventListener('resize', () => Render.resize());
    newWorld({ w: 400, h: 225, type: 'continents', seed: (Math.random() * 2 ** 32) >>> 0, nations: 6 });
    Tools.setTool('paint');
    requestAnimationFrame(t => { last = t; loop(t); });
    if (!localStorage.getItem('openmaps-seen-help')) {
      try { Util.$('dlg-help').showModal(); localStorage.setItem('openmaps-seen-help', '1'); } catch (e) { /* ignore */ }
    }
  }

  window.addEventListener('DOMContentLoaded', init);
  return { newWorld, newWorldFromDialog, loadScenario };
})();
