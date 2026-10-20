<h1 align="center">Sidelight</h1>

<p align="center"><b>Long answers from your coding agent, made readable.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/omp-sidelight"><img src="https://img.shields.io/npm/v/omp-sidelight?color=cb3837" alt="npm"></a>
  <a href="https://github.com/Mannan-Goyal/omp-sidelight/actions/workflows/test.yml"><img src="https://github.com/Mannan-Goyal/omp-sidelight/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="https://github.com/can1357/oh-my-pi"><img src="https://img.shields.io/badge/omp-%E2%89%A518.11-5865F2" alt="omp 18.11 or newer"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT"></a>
</p>

![Sidelight: reading a long answer, selecting a passage, asking about it and following up](https://raw.githubusercontent.com/Mannan-Goyal/omp-sidelight/main/assets/reader.gif)

When your agent explains something big, you get a wall of text in a scrolling chat. It's hard to read, harder to understand, and asking about one paragraph means a new turn that drags the whole conversation off course.

**Sidelight gives long answers a proper page, and lets you question any line of it on the side.** It's a plugin for [omp](https://github.com/can1357/oh-my-pi).

- **Read it like a document, not a chat log.** Full screen, with rendered tables and diagrams, an outline, search, and a scrollbar that shows how long the document is and where you are.
- **Ask about exactly the part you don't get.** Select a sentence and press a key. The answer arrives in a side thread that knows your whole conversation.
- **Your conversation stays clean.** Side questions never enter the agent's context, so the main session stays on topic.
- **Revisions show what changed.** The agent edits the page in place, and the changed blocks are marked, so you never reread everything.

## Install

You need omp 18.11 or newer.

```sh
omp plugin install omp-sidelight
```

Restart omp, and you're set. You can also install straight from GitHub (`omp plugin install github:Mannan-Goyal/omp-sidelight`) or from inside omp:

```text
/marketplace add Mannan-Goyal/omp-sidelight
/marketplace install sidelight@omp-sidelight
```

To uninstall: `omp plugin uninstall omp-sidelight`.

## First run

The first time you open the reader, it offers a two-minute guided tour. The tour opens a sample document and walks you through every feature, moving on only after you've actually tried each step. Replay it any time with `/read tour`, or press `?` in the reader for every key.

![The first-run tour](https://raw.githubusercontent.com/Mannan-Goyal/omp-sidelight/main/assets/tour.gif)

## Using it

1. **Ask for an explanation as usual.** When the reply would be long, the agent calls the plugin's `explain` tool. It writes a document, and the chat shows a short summary with a `📖` line.
2. **Open it** with `/read` or `ctrl+n`. With several documents, you pick one from a list.
3. **Read, select, ask.** Answers stream into the side pane on the right.

`/read` also opens:

| Command | Opens |
|---|---|
| `/read` | the agent's documents, newest first, then saved replies, then files you opened before |
| `/read last` | the agent's latest chat reply, as a document |
| `/read notes.md` | any markdown file |
| `/read tour` | the guided tour |

The agent decides when to write a document; you can also ask for one ("write this up as an explain document").

## Controls

Press `?` in the reader to see these at any time.

**Document**

| Key | Action |
|---|---|
| `j` `k` `↑` `↓` | move a line |
| `[` `]` | previous / next block (paragraph, list, table, code) |
| `{` `}` | previous / next section |
| `space` `b` `PgDn` `PgUp` | page down / up |
| `g` `G` | top / bottom |
| `v` | start selecting; move to extend; `v` again cancels |
| `V` | select the block under the cursor |
| `a` or `Enter` | ask about the selection, or the block under the cursor |
| `1`–`6` | quick ask: simpler · why · example · define · how it connects · intuitive |
| `d` `D` | next / previous change since you last read |
| `t` `T` | next / previous thread |
| `/` `n` `N` | search · next / previous match |
| `y` | copy the selection |
| `o` | outline; `Enter` on a heading jumps there |

**Question box** (asking about a passage, or a thread's follow-up box)

| Key | Action |
|---|---|
| `Enter` | send |
| `Shift+Enter` or `Alt+Enter` | new line |
| `1`–`6` on an empty box | quick ask (while asking about a passage) |
| `PgUp` `PgDn` | scroll the thread above the box |
| `Esc` | asking: abandon the question · in a thread: step out of the box |

**Thread** (after `Esc` out of the box)

| Key | Action |
|---|---|
| `f` `i` `Enter` | back into the follow-up box |
| `j` `k` `space` `b` | scroll |
| `c` | cancel the answer that is streaming |
| `p` | paste the thread into the chat composer (it is not sent) |
| `y` | copy the latest answer |
| `r` | resolve / reopen |
| `x` `x` | delete |
| `Esc` | back to the thread list; a running answer keeps going |

**Anywhere**

| Key | Action |
|---|---|
| `Tab` | switch between the document and the side pane |
| `z` | show only the focused pane at full width, for wide tables and diagrams |
| `?` | all keys |
| `q` | close the reader |

**Mouse:** hover highlights a block, click moves the cursor, drag selects, double-click selects a block, and the wheel scrolls the pane under the pointer. Shift+drag still selects text the terminal's usual way.

### Thread list

Threads are grouped by what they need from you:

| Icon | Group |
|---|---|
| spinner | Answering |
| `✦` | New answers you haven't looked at |
| `●` | Open |
| `✓` | Resolved |
| `△` | Passage changed: the text it was about was rewritten |

The same icon marks the passage in the document's left margin.

| A thread | The thread list | Every key (`?`) |
|---|---|---|
| ![A thread](https://raw.githubusercontent.com/Mannan-Goyal/omp-sidelight/main/assets/thread.png) | ![The thread list](https://raw.githubusercontent.com/Mannan-Goyal/omp-sidelight/main/assets/threads.png) | ![Help](https://raw.githubusercontent.com/Mannan-Goyal/omp-sidelight/main/assets/help.png) |

## What stays private

- **Side threads never enter the conversation.** They use omp's side-turn API (`ctx.runEphemeralTurn`, the same one `/btw` uses). Nothing is written to the session journal, so the agent doesn't see your questions later, and they aren't in exports.
- **Everything is stored in the session's own folder:** documents, their versions, and your threads. Nothing leaves your machine except the model calls for your questions.
- **Each question sends** your conversation, the document (or, for a very long one, its outline and the passage's surroundings), the passage and your question, to the model you're using.

## Requirements and limits

- omp 18.11 or newer, in the interactive terminal UI.
- Below 110 columns the reader shows one pane at a time; `Tab` switches between them.

## How it works

[docs/design.md](https://github.com/Mannan-Goyal/omp-sidelight/blob/main/docs/design.md) covers the architecture, the data layout and the side-turn contract. [docs/research.md](https://github.com/Mannan-Goyal/omp-sidelight/blob/main/docs/research.md) lists the sources behind the design choices.

## Development

```sh
git clone https://github.com/Mannan-Goyal/omp-sidelight
omp plugin link ./omp-sidelight   # omp now loads your working copy
npm test                          # unit tests (Node 22+)
./demo/record-demos.sh            # regenerate the GIFs and screenshots (needs vhs)
```

## License

MIT
