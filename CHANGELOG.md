# Changelog

## 0.2.0

- The reader shows a scrollbar on the document's right edge. The thumb's size shows how much of the document fits on screen, and its position shows where you are. Unless the window is tiny, it touches the top only at the start and the bottom only at the end. It disappears when the whole document fits.

## 0.1.1

- Published to npm: `omp plugin install omp-sidelight`.
- The README works on npm too (absolute image links), with badges and a clearer pitch.
- The npm package no longer ships the demo GIFs and screenshots.

## 0.1.0

First public release of Sidelight.

- `explain` tool: the agent publishes long explanations as versioned markdown documents.
- Full-screen reader (`/read`, `ctrl+n`) with keyboard and mouse selection, outline, search, zoom and change markers.
- Side threads: ask about any passage; answers never enter the conversation. Quick asks `1`–`6`, multi-line follow-ups, threads grouped by state.
- Guided first-run tour (`/read tour`) and a full key reference (`?`).
