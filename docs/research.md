# Explanation reader — prior art & ranked features for a TUI-only build

Goal: the agent writes a long explanation to a **file**; the user reads it in an **in-place overlay** in the same terminal, **quotes with the keyboard**, and asks about it in a **side thread** that keeps main-conversation context and never appends to main chat. Rows come from the linked primary page. `[int]` = omp internals (`omp://slash-command-internals.md` §11–13; `omp://tui.md`).

## 1. AI products: selection-scoped questions & side threads

| Product | Feature | How it works | URL |
|---|---|---|---|
| ChatGPT (Canvas → writing blocks) | Highlight/select → revise in place | Canvas: "highlight specific sections to indicate exactly what you want ChatGPT to focus on"; current docs: "Ask ChatGPT to revise selected text or the entire draft" | openai.com/index/introducing-canvas/ · help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt |
| ChatGPT | Branch in new chat | "select Branch in new chat to start a separate conversation from that point"; what the branch inherits is **not** documented | help.openai.com/en/articles/6825453-chatgpt-release-notes |
| Claude Docs/Artifacts | Highlight → "Edit with Claude" | "Claude makes the edit where you marked it"; requests left in several files batch into one message; editing an earlier message makes "a different version of the chat, with its own artifacts" | support.claude.com/en/articles/17153992 |
| NotebookLM | Source-grounded Q&A + citations | "To navigate directly to the quote and review it in context, select a citation" | blog.google/innovation-and-ai/technology/ai/notebooklm-google-ai/ · support.google.com/gemininotebook/answer/16179559 |
| Readwise Reader | Ask about a highlight in a side chat | "The chat opens with that highlight attached"; presets vary by selection size; `G` selection, `shift+G` doc | docs.readwise.io/reader/guides/ghostreader/chat |
| Cursor | Add selection to chat / inline ask | "Cmd Shift L with code selected → Add selected code as context"; "Cmd L → Add selection to new chat" | cursor.com/docs/reference/keyboard-shortcuts |
| VS Code Copilot Chat | Context references | "#selection adds the selected editor text"; `#`-mention picker / **Add Context** | code.visualstudio.com/docs/agents/reference/tools-reference |
| Zed | Inline assistant on selection | "sends your current selection (or line) to a language model and replaces it with the response" | zed.dev/docs/ai/inline-assistant |
| Notion AI | Inline ask on selection | "highlight the text and select `Edit with AI`"; a selection can "get synonyms and define words" | notion.com/help/guides/notion-ai-for-docs |
| Perplexity | Sessions (formerly Threads) keep follow-up context | "A session is like a conversation history that remembers everything you've discussed" | perplexity.ai/help-center/en/articles/10354769-what-is-a-thread |
| Kagi Assistant | Page-scoped only | "Continue in Assistant" asks further questions about a search result; no highlight→ask is documented | help.kagi.com/kagi/ai/assistant.html |

## 2. Annotation / thread UX

| Product | Feature | How it works | URL |
|---|---|---|---|
| Google Docs | Comment, reply, resolve | "you can resolve a comment to close it"; `R` reply, `J`/`K` navigate, `E` resolve | support.google.com/docs/answer/65129 · /179738 |
| Hypothesis | Anchoring that survives edits | stores "three different selectors", re-attaching with fuzzy matching when the page changes | web.hypothes.is/blog/fuzzy-anchoring/ · w3.org/TR/annotation-model/#text-quote-selector |
| GitHub PR review | Line-anchored threads, resolve, outdated | comment on a diff line/range, reply beneath; "click Resolve conversation" | docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request |
| Slack | Threads keep detail out of the channel | "without adding clutter to a channel or DM" | slack.com/help/articles/115000769927-Use-threads-to-organize-discussions |
| Claude artifacts | Comments → Claude, resolve | **Send to Claude** activates a thread; "Claude can reply to or resolve only an activated thread" | code.claude.com/docs/en/artifacts |

## 3. Terminal idioms: readers, panes, keyboard selection, mouse

| Tool | Idiom | Keys / mechanism | URL |
|---|---|---|---|
| less | read + search + anchor | `/pattern`, `n`/`N`, `m<x>` mark, `&pattern` filters to matching lines | man7.org/linux/man-pages/man1/less.1.html |
| bat | range + emphasis | pages by default; `-r/--line-range N:M`, `-H/--highlight-line <N:M>` | github.com/sharkdp/bat |
| glow | TUI markdown reader | "run `glow` without arguments to start the textual user interface"; `?` hotkeys | github.com/charmbracelet/glow |
| Vim | selection model | `v`/`V`/`Ctrl-V`; `gv` "Start Visual mode with the same area as the previous area"; `'<`/`'>` marks | vimhelp.org/visual.txt.html |
| lazygit | focus + remote scroll | `1–5` panels, `0` main view, scroll main window unfocused, `?` keys | lazygit.dev/keybindings/ |
| tig | split view | Enter splits log/diff; "switch between the two views by pressing Tab" | jonas.github.io/tig/doc/manual.html |
| aerc | per-context keys | contexts (`[compose::review]`) in `binds.conf` | man.archlinux.org/man/aerc-binds.5.en |
| k9s | command mode + help | `:` accepts "singular, plural, short-name or alias"; `?` help | k9scli.io/topics/commands/ |
| w3m | cursor nav, **no copy** | mouse only navigates — "left drag Scroll document"; no clipboard function | w3m.sourceforge.net/MANUAL |
| tmux | keyboard selection | `Space` begin-selection, `v` rectangle, `Esc` clear, `Enter` copy-and-cancel | man.openbsd.org/tmux |
| Terminal | mouse reporting | DECSET `1000`/`1002`/`1003`; `1006` "SGR Mouse Mode"; `1049` alt screen; OSC 52 clipboard write (may be disabled) | invisible-island.net/xterm/ctlseqs/ctlseqs.html |
| Terminal | selection escape hatch | with tracking on, unshifted clicks belong to the app; "you can always do select/paste by pressing the shift key while clicking" | invisible-island.net/xterm/xterm.faq.html |

## 4. Learning science behind the feature set

| Technique | Finding | URL |
|---|---|---|
| Elaborative interrogation + self-explanation | both "received moderate utility assessments" and "have not been adequately evaluated in educational contexts"; rereading/highlighting are low utility | pubmed.ncbi.nlm.nih.gov/26173288/ |
| Self-explanation prompting | 64 studies: "significant overall mean effect of *g*= 0.55"; "a potentially powerful intervention" | link.springer.com/article/10.1007/s10648-018-9434-x |
| Progressive disclosure | "show users only a few of the most important options"; "beyond 2 disclosure levels typically have low usability" (practitioner source) | nngroup.com/articles/progressive-disclosure/ |
| Segmenting / signaling / pre-training | "learner-paced segments, rather than as continuous units"; "signaling is associated with increased learning outcomes (d = .38)"; learners do better "when they know the names and behaviors of the components" | link.springer.com/article/10.1007/s10648-018-9456-4 · link.springer.com/article/10.1007/s11423-020-09748-7 · uky.edu/~gmswan3/544/9_ways_to_reduce_CL.pdf |
| Headings / advance organizers | "Passages with headings were recalled significantly better"; advance organizers only "a small facilitative effect" | eric.ed.gov/?id=EJ233231 · ?id=EJ233576 |
| Multi-level "explain simpler" | **No solid source found**; learner control is "almost zero (g = 0.05)" and expertise reversal means novice support can hurt experts | eric.ed.gov/?id=EJ1034262 · springer.com/article/10.1007/s10648-007-9054-3 |

## 5. Iterative documents: showing what changed

| Product | Mechanism | URL |
|---|---|---|
| ChatGPT | Canvas back button restores earlier versions; writing/code blocks offer "Undo or redo recent AI-assisted edits", and edits "save with the conversation" so follow-ups use the latest version | openai.com/index/introducing-canvas/ · help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt |
| Google Docs | version panel lists "who updated the file and their changes"; **Restore this version** | support.google.com/docs/answer/190843 |
| VS Code | "files changed bar"; per-edit **Keep**/**Undo** in an inline diff; **Restore Checkpoint**; **Fork** | code.visualstudio.com/learn/foundations/reviewing-and-controlling-agent-changes |
| Claude artifacts | "Each publish becomes a version, and from the Share control … you can choose which version viewers see" | code.claude.com/docs/en/artifacts |
| GitHub PR | threads become unresolved / resolved / **outdated** as the diff moves | docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request |

## 6. Ranked features for our TUI reader

"Why" cites the tables above (ChatGPT, Readwise, NotebookLM, Hypothesis, VS Code, GitHub, NN/g, Dunlosky, Bisra, Rey, Alpizar).

### Must

| # | Feature | Why it helps understanding | TUI feasibility |
|---|---|---|---|
| M1 | File-backed explanation in an in-place overlay | Canvas edits one document in place instead of regenerating; re-reading regenerated prose is the low-utility rereading pattern | `ctx.ui.custom(factory,{overlay:true})` renders markdown overlays; `/annotate` opens files in one `[int]`. Low |
| M2 | Keyboard-only selection: `j`/`k`, `v`, `gg`/`G`, `PgUp`/`PgDn`, `/`+`n` | selection is the input handle for everything else; Vim visual mode and less search are the proven vocabulary | pure key handling, no deps `[int]`. Low |
| M3 | Quote → ask in a side thread seeded with the quote | Readwise opens chat "with that highlight attached"; self-explanation prompting beats passive reading (*g*=0.55) | `/btw` uses the viewed session's context, "not appended to the main transcript" `[int]`. Low |
| M4 | Text-quote anchors (exact + prefix/suffix); retarget if moved, drop if ambiguous | Hypothesis re-anchors with three selectors; W3C `TextQuoteSelector` | `/annotate` retargets moved quotes, drops ambiguous notes `[int]`. Low |
| M5 | Outline pane with section jumps and "you are here" | headings are recalled significantly better; NotebookLM auto-builds a document guide | `/plan-review` has a Contents sidebar `[int]`. Low |
| M6 | Change gutter since your last read, plus one-key diff | Canvas "track and understand ChatGPT's changes"; VS Code's files-changed bar | native `diff` crate + diff renderer `[int]`. Medium |

### Should

| # | Feature | Why | Feasibility |
|---|---|---|---|
| S1 | Selection-scoped presets (`e` simpler, `w` why, `d` define, `x` example) | Readwise scopes presets by selection size; why-questions are elaborative interrogation; leveled explanations have no direct evidence | one key seeds M3. Low |
| S2 | Queued annotations and saved answers become margin notes; never auto-submitted | Claude batches several file requests into one message; Readwise keeps answers in the note field | `/annotate` note model (Enter saves, Esc discards) `[int]`. Low |
| S3 | Glossary-on-demand for the selected term, in place | pre-training: learners do better "when they know the names and behaviors of the components" (median effect 1.00) | reuses M2+M3, rendered in the overlay. Low–medium |
| S4 | Collapsible sections | segmenting: "learner-paced segments, rather than as continuous units"; NN/g: >2 levels has low usability | collapse by heading depth. Medium |

### Could

| # | Feature | Why | Feasibility |
|---|---|---|---|
| C1 | Reopenable per-quote thread history with resolve/collapse | GitHub/Google Docs resolve stop threads piling up; Readwise "remembers the conversation so far" | bare `/btw` opens history with list+detail panes `[int]`. Low |
| C2 | Promote a side answer into a real chat branch | ChatGPT's "Branch in new chat" and VS Code's Fork both leave the original intact: "The original session stays intact" | `/btw` `b` promotes a single-turn answer `[int]`. Low |

### Anti-features

| Anti-feature | Reason |
|---|---|
| Browser page, separate OS window, or default fullscreen takeover | violates the one-terminal constraint; Canvas "opens in a separate window", Claude Code artifacts open at a claude.ai URL; fullscreen loses transcript context and scrollback |
| Mouse-drag as the primary path (mouse may only be an accelerator) | `tui.mouse` is off by default; when on, unshifted clicks go to the app and native selection needs Shift — breaks native copy and non-SGR terminals |
| Re-printing the whole explanation each turn | defeats the file-backed model; Canvas's targeted edits exist to avoid exactly this |
| Auto-submitting, or any path that appends reader Q&A to the main transcript | Cursor defaults to queue-not-send; silent submits pollute the one conversation that must stay clean |
| A third disclosure level / nested sub-panes | "beyond 2 disclosure levels typically have low usability" (NN/g); every extra pane is more to manage |
| Being a better highlighter or rereader | highlighting and rereading are low-utility; the value is the *ask*, not the collection |
