# OpenMaps — Mapping Creator

A browser-based mapping game in the spirit of *Mapping Creator* on Steam: draw history the
way you want it. Paint nations onto a pixel map with a pixel-perfect brush, shape coastlines,
name countries and design their flags, then push armies across the map and watch borders
move. Everything is recorded to a timelapse you can scrub through and export as a video —
no external screen-recording software needed.

No build step, no dependencies. Open `index.html` in a modern browser (Chrome / Edge /
Firefox), or serve the folder:

```
python3 -m http.server 8000
# → http://localhost:8000
```

## Features

- **Procedural worlds** – continents, archipelago, pangea or a blank canvas, in three sizes,
  optionally pre-seeded with nations and ragged organic borders. Seeds are reproducible.
- **Nation painting** – paint, erase, flood-fill and pick tools with adjustable brush size,
  1-pixel borders, optional painting over water.
- **Terrain tools** – raise land or sink it into the sea.
- **Nation editor** – rename, recolour, toggle labels and design a 12×8 pixel flag with a
  palette, presets (tricolour, cross, nordic, diagonal, …) or a random generator.
- **Armies** – place units, drag them around, rotate them with a handle or `Q`/`E`, set
  size and orders. Press **PLAY**: armies advance along their heading and claim land. When
  enemy armies meet they form a front and fight; the bigger, healthier side wins. Reinforce,
  resize or disband units to decide the outcome.
- **Timeline** – every stroke, edit and simulation tick is a frame. Undo, scrub, play back.
- **Export** – PNG snapshot of the map, or render the whole history to a WebM timelapse
  video in-browser (MediaRecorder).
- **Save / load** – scenarios (with or without history) as JSON.

## Controls

| Key | Action |
| --- | --- |
| `B` `E` `G` `I` | Paint / Erase / Fill / Pick |
| `L` `W` | Land / Water terrain brush |
| `U` `V` `H` | Unit / Move / Pan tools |
| `[` `]` or Ctrl+wheel | Brush size |
| Wheel · Space+drag · middle mouse | Zoom · pan |
| `Q` `E` (shift) | Rotate selected unit |
| `Space` | Play / pause the war |
| `Ctrl+Z` | Undo |
| `Delete` | Disband selected unit |
| Right-click map | Pick that nation |
| `F` | Fit map to window |

## Project layout

```
index.html        UI layout
css/style.css     pixel-style theme
js/util.js        helpers (PRNG, colours, names)
js/mapgen.js      value-noise terrain generator
js/state.js       world state, nations, units, flags, (de)serialisation
js/history.js     frame-based undo / timeline
js/render.js      pixel renderer, labels, units, camera
js/sim.js         war simulation (advance, capture, combat)
js/tools.js       pointer tools (brushes, fill, unit drag/rotate, pan)
js/recorder.js    timelapse playback + WebM / PNG export
js/ui.js          side panels, flag editor, timeline controls
js/main.js        bootstrap, game loop, shortcuts
```
