#!/usr/bin/env bash
# Regenerate the README's GIFs and screenshots. Needs vhs (brew install vhs), omp with
# this plugin installed, and a configured model: the demos make real side-turn calls.
set -euo pipefail
cd "$(dirname "$0")/.."
state="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}/explain-reader/tour.json"
backup=""
if [[ -f "$state" ]]; then backup="$(mktemp)"; cp "$state" "$backup"; fi
restore() { if [[ -n "$backup" ]]; then cp "$backup" "$state"; else rm -f "$state"; fi; }
trap restore EXIT

mkdir -p "$(dirname "$state")"
# Main demo: no first-run card.
echo '{"offered": true, "completed": true}' > "$state"
vhs demo/reader.tape
# VHS's Screenshot can capture a frame late, so the last two screenshots are cut from the
# GIF itself: the thread list is on screen about 6s before the end, the key help about 2s.
ffmpeg -loglevel error -y -sseof -6 -i assets/reader.gif -frames:v 1 assets/threads.png
ffmpeg -loglevel error -y -sseof -2 -i assets/reader.gif -frames:v 1 assets/help.png
rm -f "$state"
vhs demo/tour.tape
