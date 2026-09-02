/* Timeline / undo. Every change to the world is recorded as a frame so it can be
   undone, scrubbed and rendered to a timelapse video. */
'use strict';

const History = (() => {
  let initial = null;     // { owner, elev, units, nations }
  let frames = [];        // { cells:Int32Array(idx,old,new)*, elev:Int32Array, units, nations|null }
  let cursor = 0;         // number of frames currently applied
  let pending = null;     // { cells:Map, elev:Map }
  let lastNationsJson = '';

  const clone = o => JSON.parse(JSON.stringify(o));

  function reset() {
    initial = {
      owner: new Uint16Array(State.owner),
      elev: new Uint8Array(State.elev),
      units: clone(State.units),
      arrows: clone(State.arrows),
      nations: clone(State.nations),
    };
    lastNationsJson = JSON.stringify(State.nations);
    frames = []; cursor = 0; pending = null;
    UI.timelineChanged();
  }

  /* Discard any "future" frames if the user edits after scrubbing back. */
  function truncate() {
    if (cursor < frames.length) {
      frames.length = cursor;
      // recompute lastNationsJson for the new head
      lastNationsJson = JSON.stringify(nationsAt(cursor));
    }
  }

  function begin() {
    if (pending) return;
    truncate();
    pending = { cells: new Map(), elev: new Map() };
  }
  function setOwner(i, v) {
    if (State.owner[i] === v) return;
    if (!pending.cells.has(i)) pending.cells.set(i, State.owner[i]);
    State.owner[i] = v;
    State.dirty = true; State.labelsDirty = true;
  }
  function setElev(i, v) {
    if (State.elev[i] === v) return;
    if (!pending.elev.has(i)) pending.elev.set(i, State.elev[i]);
    State.elev[i] = v;
    State.dirty = true; State.labelsDirty = true;
  }
  /* Called when units / nations were changed directly (they are snapshotted whole). */
  function touch() { begin(); pending.forced = true; }

  function commit() {
    if (!pending) return false;
    const p = pending; pending = null;
    const nj = JSON.stringify(State.nations);
    const nationsChanged = nj !== lastNationsJson;
    if (!p.cells.size && !p.elev.size && !p.forced && !nationsChanged) return false;

    const cells = new Int32Array(p.cells.size * 3);
    let k = 0;
    for (const [i, old] of p.cells) { cells[k++] = i; cells[k++] = old; cells[k++] = State.owner[i]; }
    const elev = new Int32Array(p.elev.size * 3);
    k = 0;
    for (const [i, old] of p.elev) { elev[k++] = i; elev[k++] = old; elev[k++] = State.elev[i]; }

    frames.push({ cells, elev, units: clone(State.units), arrows: clone(State.arrows), nations: nationsChanged ? clone(State.nations) : null });
    if (nationsChanged) lastNationsJson = nj;
    cursor = frames.length;
    UI.timelineChanged();
    return true;
  }

  function nationsAt(n) {
    for (let i = n - 1; i >= 0; i--) if (frames[i].nations) return frames[i].nations;
    return initial.nations;
  }
  function unitsAt(n) { return n === 0 ? initial.units : frames[n - 1].units; }
  function arrowsAt(n) { return (n === 0 ? initial.arrows : frames[n - 1].arrows) || []; }

  function applyFrame(f, forward) {
    const c = f.cells, e = f.elev;
    for (let i = 0; i < c.length; i += 3) State.owner[c[i]] = forward ? c[i + 2] : c[i + 1];
    for (let i = 0; i < e.length; i += 3) State.elev[e[i]] = forward ? e[i + 2] : e[i + 1];
  }

  /* Move the world to the state after frame n. */
  function seek(n) {
    n = Util.clamp(n, 0, frames.length);
    if (n === cursor) return;
    if (pending) commit();
    while (cursor < n) { applyFrame(frames[cursor], true); cursor++; }
    while (cursor > n) { cursor--; applyFrame(frames[cursor], false); }
    State.units = clone(unitsAt(cursor));
    State.arrows = clone(arrowsAt(cursor));
    State.nations = clone(nationsAt(cursor));
    if (!State.nation(State.selectedNation)) State.selectedNation = State.nations.length ? State.nations[0].id : 0;
    if (State.selectedUnit && !State.unit(State.selectedUnit)) State.selectedUnit = null;
    State.dirty = true; State.labelsDirty = true;
    UI.timelineChanged();
    UI.refreshNations();
  }

  function undo() {
    if (pending) commit();
    if (cursor === 0) return;
    seek(cursor - 1);
    frames.length = cursor;
    lastNationsJson = JSON.stringify(State.nations);
    UI.timelineChanged();
  }

  /* ---- persistence ---- */
  const b64 = Util.b64, unb64 = Util.unb64;
  function serialize() {
    return {
      initial: { owner: b64(initial.owner), elev: b64(initial.elev), units: initial.units, arrows: initial.arrows, nations: initial.nations },
      frames: frames.map(f => ({ c: b64(f.cells), e: b64(f.elev), u: f.units, a: f.arrows, n: f.nations })),
      cursor,
    };
  }
  function deserialize(d) {
    initial = {
      owner: new Uint16Array(unb64(d.initial.owner).buffer),
      elev: unb64(d.initial.elev),
      units: d.initial.units, arrows: d.initial.arrows || [], nations: d.initial.nations,
    };
    frames = d.frames.map(f => ({
      cells: new Int32Array(unb64(f.c).buffer), elev: new Int32Array(unb64(f.e).buffer), units: f.u, arrows: f.a || [], nations: f.n,
    }));
    cursor = frames.length; // the saved owner/elev arrays are the head state
    lastNationsJson = JSON.stringify(nationsAt(cursor));
    pending = null;
    if (d.cursor !== undefined && d.cursor !== cursor) seek(d.cursor);
    UI.timelineChanged();
  }

  return {
    reset, begin, setOwner, setElev, touch, commit, seek, undo, serialize, deserialize,
    get length() { return frames.length; },
    get cursor() { return cursor; },
    get atHead() { return cursor === frames.length; },
    hasInitial() { return !!initial; },
  };
})();
