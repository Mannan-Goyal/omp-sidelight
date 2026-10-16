# Sidelight: design

A TUI reader for long explanations, packaged as an omp plugin. Read rendered markdown
full-screen, select any passage with keys or the mouse, and ask about it in a side thread
that knows the whole conversation but never adds anything to it.

Research behind the choices, with sources: [research.md](./research.md).

## The problem

| Today | Cost |
|---|---|
| Long answers are printed into chat | Every revision reprints everything; the chat scrolls away from the work |
| Asking about one sentence means a new main-chat turn | The question and answer stay in the main context forever |
| No way to point at a passage | "In section 8 where you said X" is retyped by hand |

## How it works

```
agent ── write/edit ──▶ local://explain/<slug>.md ── explain tool ──▶ version snapshot
                                                                         │
you ── /read or ctrl+n ──▶ full-screen reader (alt screen, like less/vim) ◀┘
          │  select passage (keys or mouse)
          ▼
   side thread ── ctx.runEphemeralTurn (same pipeline as /btw) ──▶ answer streams in
          │         conversation context included, nothing appended to the session
          ▼
   saved in <session artifacts>/explain-reader/  (sidecar, not the session journal)
```

## Features and why

| Feature | Why | Source of the idea |
|---|---|---|
| **File-backed docs** the agent edits surgically, published as versions | Targeted edits instead of regenerating; rereading regenerated prose is low-value | ChatGPT Canvas, Claude artifacts |
| **Rendered markdown** (tables, code, mermaid as ASCII) using chat's own renderer | Same look as chat; raw markdown tables are hard to read | omp `Markdown` + `getMarkdownTheme()` |
| **Full-screen in place**, one key to open and close | No windows to manage; transcript untouched underneath | `less`/`vim` alternate screen |
| **Keyboard selection** (`j/k`, `v`, `V`, `{ }`, `[ ]`, `/`) | Selection is the input for everything else; vim/less vocabulary is already known | Vim visual mode, less |
| **Mouse as accelerator**: hover highlight, click, drag-select, wheel | You asked for hover; works by default in a full-screen overlay | xterm SGR mouse (`?1003h`) |
| **Quote → ask** in a side thread, seeded with the passage | Questions about a specific passage are where understanding happens | Readwise Ghostreader; self-explanation research (g = 0.55) |
| **Quick asks** `1`–`6`: simpler, why, example, define, how it connects, intuitive | One key for the questions you ask most | Readwise presets |
| **Threads per passage**, grouped into Answering / New answers / Open / Resolved / Passage changed, with follow-ups and resolve | Questions stay attached to what they are about; the group says what needs you | Google Docs, GitHub review threads |
| **Chat-style thread**: your question in the chat's filled user bubble, the answer as plain text, omp's own "Working…" loader while it streams | Looks and reads like the main chat, so who said what is obvious | omp `Loader`, `userMessageBg` |
| **Always-ready follow-up box**, multi-line (Shift+Enter), pinned at the bottom of a thread | Follow-ups are the common next step; no extra key to start one | omp chat composer (`Editor`) |
| **Anchors that survive edits**; moved text retargets, changed text shows as *outdated* | Revisions should not orphan your questions | Hypothesis, W3C TextQuoteSelector, GitHub "outdated" |
| **Change markers since you last read** + jump to next change | You only reread what changed | Canvas change tracking, VS Code files-changed |
| **Outline** with "you are here" | Headings improve recall; jumping beats scrolling | NotebookLM guide, headings research |
| **Send to chat** (`p`) pastes a thread into the composer, never submits | Sometimes an answer should change the main work, but only on purpose | `/annotate` paste-never-submit, Claude "Send to Claude" |
| **`/read last`** turns the latest long chat reply into a doc | Works for explanations that were printed into chat | — |

Deliberately left out: browser view or extra windows (your constraint), auto-sending anything
to the main chat, a third nesting level of panes, and "explain at 3 levels" (no evidence it helps).

## Keys

| Doc pane | |
|---|---|
| `j` `k` `↑` `↓` | move line |
| `[` `]` · `{` `}` | previous/next block · previous/next section |
| `space` `b` `PgDn` `PgUp` `g` `G` | page, top, bottom |
| `v` · `V` · `Esc` | start selecting (move to extend; `v` again cancels, like vim) · select block · clear |
| `a` or `Enter` | ask about the selection (or the block under the cursor) |
| `1`–`6` | quick ask: simpler · why · example · define · how it connects · intuitive |
| `d` `D` · `t` `T` | next/previous change · next/previous thread |
| `/` `n` `N` | search |
| `y` · `o` · `Tab` · `q` | copy · outline · switch pane · close |
| `z` | zoom: show only the focused pane at full width (for wide diagrams and tables); `z` again restores the split |

| Question box (asking, or a thread's follow-up box) | |
|---|---|
| `Enter` · `Shift+Enter` | send · new line (`Alt+Enter` also works) |
| `1`–`6` on an empty box while asking | quick ask |
| `PgUp` `PgDn` | scroll the thread above the box |
| `Esc` | asking: abandon the question · thread: step out of the box (browse) |
| `Tab` | back to the document |

| Thread, browsing (after Esc) | |
|---|---|
| `f` `i` `Enter` | back into the follow-up box |
| `j` `k` `space` `b` | scroll |
| `c` · `p` · `y` · `r` · `x` | cancel the running answer · paste into chat composer · copy answer · resolve · delete |
| `Esc` | back to the list (a running answer keeps going, under "Answering") |

| Thread list | |
|---|---|
| `↑` `↓` `Enter` | pick and open a thread (doc scrolls to its passage) |
| `r` · `x` | resolve · delete |

Icons, in the list and the document gutter: spinner answering · `✦` new answer you haven't seen · `●` open ·
`✓` resolved · `△` the passage changed.

Mouse: hover highlights the block; click puts the cursor there; drag selects; wheel scrolls
the pane under the pointer. Shift+drag still does native terminal selection.

## What `/read` offers

One list feeds both the `/read` completion menu and the `ctrl+n` picker, in this order:

1. explanations the agent wrote under `local://explain/` (published or auto-saved), newest first, with version, age and note;
2. replies saved with `/read last`;
3. outside files opened before with `/read <path>`, so their threads are one step away.

A document whose file is gone or empty is left out. `last` is offered only when there is an
assistant reply to turn into a document. Typing filters by name or title.

## Data

| What | Where |
|---|---|
| Document | `<artifacts>/local/explain/<slug>.md` = `local://explain/<slug>.md` |
| Versions | `<artifacts>/explain-reader/docs/<slug>/v<n>.md` + `meta.json` (title, notes, last-read version) |
| Threads | `<artifacts>/explain-reader/docs/<slug>/threads.json` |
| Other files opened with `/read <path>` | same layout under a slug derived from the path |

Nothing is written to the session journal, so side threads never enter the main context
and are not included in exports, the same guarantee `/btw` gives.

## Side-turn contract

- `ctx.runEphemeralTurn` with the thread's earlier turns as `history`, one `conversationKey`
  per thread (rotated after cancel or failure), `replyMaxBytes: Infinity` (the default cuts
  answers at 4 KiB), tools left in the request so the main prompt cache is reused.
- The first turn carries the document version and the quoted passage; follow-ups carry only
  the question, plus the current text of the passage if the document changed since.
- Several threads may run at once; one thread runs one question at a time.
- The current turn's prompt states the side pane's width, so answers keep diagrams and tables
  narrow enough to read without zooming. Only the current turn carries it, so the replayed
  history stays byte-stable for the prompt cache.
