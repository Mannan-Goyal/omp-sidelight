# Changelog

## Unreleased

- Links in the reader open: click one, or press `l` on its line (with several, pick one by number). Web and mail links go to your default browser or mail app; other kinds are not opened.
- Reference-style links (`[text][ref]` with a `[ref]: url` line on its own elsewhere in the document) render like inline links, and the definition lines no longer show. If a label is defined twice, the first definition wins. Definitions inside lists and quotes aren't collected yet.

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
