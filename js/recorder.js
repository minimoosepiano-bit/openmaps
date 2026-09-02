/* Timelapse playback and WebM video export via canvas.captureStream + MediaRecorder. */
'use strict';

const Recorder = (() => {
  let playing = false, playAcc = 0;
  let recording = false;

  function update(dt) {
    if (!playing) return;
    const fps = Util.clamp(parseInt(Util.$('tl-fps').value) || 20, 1, 60);
    playAcc += dt;
    const per = 1000 / fps;
    while (playAcc >= per) {
      playAcc -= per;
      if (History.atHead) { stop(); break; }
      History.seek(History.cursor + 1);
    }
  }
  function play() {
    if (History.length === 0) return;
    if (State.playing) Sim.toggle();
    if (History.atHead) History.seek(0);
    playing = true; playAcc = 0; UI.timelapseChanged();
  }
  function stop() { playing = false; UI.timelapseChanged(); }
  function toggle() { playing ? stop() : play(); }

  /* Render every frame of the history into a video and download it. */
  async function exportVideo(fps) {
    if (recording) return;
    if (!('MediaRecorder' in window)) { UI.toast('MediaRecorder is not supported in this browser'); return; }
    if (History.length === 0) { UI.toast('Nothing recorded yet — paint something first!'); return; }
    if (State.playing) Sim.toggle();
    stop();
    recording = true;
    const status = Util.$('rec-status');
    const scale = Math.max(2, Math.min(4, Math.floor(1280 / State.w)));
    const cv = document.createElement('canvas');
    cv.width = State.w * scale; cv.height = State.h * scale;
    const c = cv.getContext('2d');
    const stream = cv.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    const startCursor = History.cursor;
    History.seek(0);
    rec.start(200);
    const total = History.length;
    const frameMs = 1000 / fps;
    const hold = 12; // hold the first and last frames a little

    const drawFrame = () => {
      State.dirty = true; State.labelsDirty = true;
      const full = Render.renderFull(scale);
      c.drawImage(full, 0, 0);
      if (track.requestFrame) track.requestFrame();
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try {
      for (let h = 0; h < hold; h++) { drawFrame(); await wait(frameMs); }
      for (let i = 1; i <= total; i++) {
        History.seek(i);
        drawFrame();
        status.textContent = `rendering ${i}/${total}`;
        await wait(frameMs);
      }
      for (let h = 0; h < hold; h++) { drawFrame(); await wait(frameMs); }
    } finally {
      rec.stop();
      await done;
      recording = false;
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      Util.download(`openmaps-timelapse.${mime.includes('mp4') ? 'mp4' : 'webm'}`, blob);
      status.textContent = `saved (${(blob.size / 1e6).toFixed(1)} MB)`;
      setTimeout(() => { status.textContent = ''; }, 5000);
      History.seek(startCursor);
    }
  }

  function exportPng() {
    const cv = Render.renderFull(Math.max(2, Math.min(4, Math.floor(1920 / State.w))));
    cv.toBlob(b => Util.download('openmaps-map.png', b), 'image/png');
  }

  return { update, play, stop, toggle, exportVideo, exportPng, get playing() { return playing; }, get recording() { return recording; } };
})();
