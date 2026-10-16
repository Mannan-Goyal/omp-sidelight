import { copyToClipboard } from "@oh-my-pi/pi-coding-agent/utils/clipboard";
import {
	type Component,
	Editor,
	Input,
	Loader,
	Markdown,
	matchesKey,
	parseSgrMouse,
	SPINNER_ADVANCE_MS,
	type SgrMouseEvent,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";
import { getEditorTheme, getMarkdownTheme, getSymbolTheme, shimmerText, type Theme } from "@oh-my-pi/pi-tui/theme";
import { PRESETS, presetFor } from "./ask";
import { TOUR_STEPS, type Tour, type TourEvent } from "./tour";
import { type Block, displaySource, normalizeText, splitBlocks } from "./blocks";
import type { OpenDoc, Runtime } from "./runtime";
import type { Anchor, DocMeta, Thread } from "./store";

interface Row {
	text: string;
	plain: string;
	/** Source block index; -1 for the blank separator between blocks. */
	block: number;
}

interface Layout {
	width: number;
	rows: Row[];
	first: number[];
	last: number[];
}

interface Span {
	start: number;
	end: number;
}

type Focus = "doc" | "side";
type SideMode = "list" | "thread" | "compose" | "outline" | "help";

export interface ReaderOptions {
	/** Run the guided tour on this document. */
	tour?: Tour;
	/** Show the one-time card offering the tour. */
	offerTour?: boolean;
	/** Called when the user accepts the offer; the reader closes itself first. */
	onStartTour?: () => void;
}

/** Every key, as `?` shows it. Kept next to the handlers so the two stay in step. */
const HELP: ReadonlyArray<{ title: string; keys: ReadonlyArray<readonly [string, string]> }> = [
	{
		title: "Document",
		keys: [
			["j k ↑ ↓", "move a line"],
			["[ ]", "previous / next block"],
			["{ }", "previous / next section"],
			["space b PgDn PgUp", "page down / up"],
			["g G", "top / bottom"],
			["v · V", "select lines (move to extend) · select the block"],
			["a or Enter", "ask about the selection, or the block under the cursor"],
			["1-6", "quick ask: simpler · why · example · define · connect · intuitive"],
			["d D", "next / previous change since you last read"],
			["t T", "next / previous thread"],
			["/ n N", "search · next / previous match"],
			["y", "copy the selection"],
			["o", "outline"],
		],
	},
	{
		title: "Question box",
		keys: [
			["Enter · Shift+Enter", "send · new line (Alt+Enter also works)"],
			["1-6 (empty box)", "quick ask, while asking about a passage"],
			["PgUp PgDn", "scroll the thread above the box"],
			["Esc", "asking: abandon · thread: step out of the box"],
		],
	},
	{
		title: "Thread (after Esc)",
		keys: [
			["f i Enter", "back into the follow-up box"],
			["j k space b", "scroll"],
			["c", "cancel the running answer"],
			["p", "paste the thread into the chat composer (not sent)"],
			["y · r · x", "copy answer · resolve · delete"],
			["Esc", "back to the thread list"],
		],
	},
	{
		title: "Anywhere",
		keys: [
			["Tab", "switch between document and side pane"],
			["z", "zoom the focused pane to full width"],
			["?", "this help"],
			["q", "close the reader"],
			["mouse", "hover, click, drag to select, wheel to scroll"],
		],
	},
];
/** Thread list sections, in display order. */
type Group = "answering" | "new" | "open" | "resolved" | "outdated";

interface Located {
	thread: Thread;
	span: Span | null;
	group: Group;
}

const GROUPS: ReadonlyArray<{ group: Group; title: string }> = [
	{ group: "answering", title: "Answering" },
	{ group: "new", title: "New answers" },
	{ group: "open", title: "Open" },
	{ group: "resolved", title: "Resolved" },
	{ group: "outdated", title: "Passage changed" },
];

/** The same message the main chat shows while the agent works. */
const WORKING_MESSAGE = "Working…";

/** Below this width only one pane is shown; Tab switches between them. */
const SPLIT_MIN_WIDTH = 110;
const DOC_SHARE = 0.6;
const GUTTER = 3;
const SCROLL_MARGIN = 3;
const WHEEL_STEP = 3;
const DOUBLE_CLICK_MS = 400;
const MESSAGE_MS = 3500;
const QUOTE_PREVIEW_LINES = 8;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07]*\x07/g;
/** A rendered row that is only table/code-block framing: no content to quote. */
const BORDER_ONLY = /^[\s─━│┃┼├┤┌┐└┘┬┴╭╮╰╯═║╔╗╚╝╠╣╦╩╬]*$/;

/** Remembered per document so reopening returns to the same place. */
const positions = new Map<string, { cursor: number; scroll: number }>();

function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const cut = truncateToWidth(text, width);
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
}

/**
 * Background across a styled row. Rendered markdown closes styles with full
 * resets (`\x1b[0m`) as well as `\x1b[49m`, either of which would end the
 * highlight mid-row, so the background is re-opened after each one.
 */
function highlightRow(text: string, width: number, bg: (text: string) => string): string {
	const open = bg("\x01").split("\x01")[0];
	return bg(fit(text, width).replace(/\x1b\[(?:0|49)?m/g, reset => `${reset}${open}`));
}

export class Reader implements Component {
	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #done: () => void;
	readonly #rt: Runtime;
	readonly #unsubscribe: () => void;

	#meta: DocMeta;
	#version: number;
	#blocks: Block[];
	#changed = new Set<number>();
	#layout: Layout | undefined;

	#focus: Focus = "doc";
	/** Show only the focused pane, at full width, for wide diagrams and tables. */
	#zoom = false;
	#cursor = 0;
	#scroll = 0;
	#selAnchor: number | null = null;
	#dragging = false;
	#hoverBlock = -1;
	#lastClick = { at: 0, row: -1 };

	#sideMode: SideMode = "list";
	#listIndex = 0;
	#outlineIndex = 0;
	#threadId: string | null = null;
	#sideScroll = 0;
	#stickBottom = true;
	#draft: Anchor | null = null;
	/** The question box: asking about a passage (compose) or following up in a thread. */
	#composer: Editor | null = null;
	/** In a thread, Esc steps out of the box so j/k/p/y/r/x work; f, Enter or Tab steps back in. */
	#browse = false;
	readonly #loaders = new Map<string, Loader>();
	#ticker: ReturnType<typeof setInterval> | undefined;
	#sideHits: Array<{ row: number; index: number }> = [];

	#search: Input | null = null;
	#matches: number[] = [];
	#matchIndex = -1;

	#message = "";
	#messageUntil = 0;
	#armDelete = 0;
	readonly #answerCache = new Map<string, string[]>();

	readonly #tour: Tour | undefined;
	#offer: boolean;
	readonly #onStartTour: (() => void) | undefined;
	#helpReturn: SideMode = "list";

	constructor(tui: TUI, theme: Theme, done: () => void, rt: Runtime, doc: OpenDoc, options: ReaderOptions = {}) {
		this.#tour = options.tour;
		this.#offer = options.offerTour === true && !options.tour;
		this.#onStartTour = options.onStartTour;
		this.#tui = tui;
		this.#theme = theme;
		this.#done = done;
		this.#rt = rt;
		this.#meta = doc.meta;
		this.#version = doc.version;
		this.#blocks = splitBlocks(doc.text);
		this.#computeChanged();
		const saved = positions.get(doc.meta.slug);
		if (saved) {
			this.#cursor = saved.cursor;
			this.#scroll = saved.scroll;
		}
		rt.readerOpen = true;
		this.#unsubscribe = rt.subscribe(() => {
			this.#answerCache.clear();
			this.#tui.requestRender();
		});
		if (this.#changed.size && !this.#tour) this.#flash(`${this.#changed.size} changed since you last read: press d to jump`);
	}

	// ── data ────────────────────────────────────────────────────────────

	#computeChanged(): void {
		this.#changed.clear();
		const lastRead = this.#meta.lastRead;
		if (!lastRead || lastRead >= this.#version) return;
		const old = new Set(splitBlocks(this.#rt.store.readVersion(this.#meta.slug, lastRead) ?? "").map(b => b.hash));
		for (const block of this.#blocks) if (!old.has(block.hash)) this.#changed.add(block.index);
	}

	#threads(): Thread[] {
		return this.#rt.threads(this.#meta.slug);
	}

	/** Where a thread's passage is now, or null when the passage no longer exists. */
	#resolve(anchor: Anchor): Span | null {
		const nearest = (hash: string, near: number): number => {
			let best = -1;
			for (const block of this.#blocks) {
				if (block.hash !== hash) continue;
				if (best < 0 || Math.abs(block.index - near) < Math.abs(best - near)) best = block.index;
			}
			return best;
		};
		const start = nearest(anchor.startHash, anchor.startIndex);
		const end = nearest(anchor.endHash, anchor.endIndex);
		if (start >= 0 && end >= start) return { start, end };
		const needle = normalizeText(anchor.quote).slice(0, 80);
		let hit = -1;
		for (const block of this.#blocks) {
			if (!normalizeText(block.source).includes(needle)) continue;
			if (hit < 0 || Math.abs(block.index - anchor.startIndex) < Math.abs(hit - anchor.startIndex)) hit = block.index;
		}
		return hit >= 0 ? { start: hit, end: hit } : null;
	}

	#groupOf(thread: Thread, span: Span | null): Group {
		if (this.#rt.isRunning(thread.id)) return "answering";
		if (this.#rt.unseen(thread) > 0) return "new";
		if (!span) return "outdated";
		return thread.resolved ? "resolved" : "open";
	}

	/** Threads in list order: by section (answering, new, open, resolved, changed), then by position. */
	#orderedThreads(): Located[] {
		const rank = (group: Group): number => GROUPS.findIndex(g => g.group === group);
		return this.#threads()
			.map(thread => {
				const span = this.#resolve(thread.anchor);
				return { thread, span, group: this.#groupOf(thread, span) };
			})
			.sort((a, b) => rank(a.group) - rank(b.group) || (a.span?.start ?? 0) - (b.span?.start ?? 0) || a.thread.createdAt - b.thread.createdAt);
	}

	/** The icon for a thread state, shared by the list and the document gutter. */
	#icon(group: Group): string {
		const t = this.#theme;
		switch (group) {
			case "answering": {
				const frames = getSymbolTheme().spinnerFrames;
				return t.fg("accent", frames[Math.floor(Date.now() / SPINNER_ADVANCE_MS) % frames.length] ?? "…");
			}
			case "new":
				return t.bold(t.fg("accent", "✦"));
			case "open":
				return t.fg("text", "●");
			case "resolved":
				return t.fg("success", "✓");
			case "outdated":
				return t.fg("warning", "△");
		}
	}

	#layoutFor(width: number): Layout {
		if (this.#layout?.width === width) return this.#layout;
		const theme = getMarkdownTheme();
		const rows: Row[] = [];
		const first: number[] = [];
		const last: number[] = [];
		for (const block of this.#blocks) {
			const lines = [...new Markdown(displaySource(block), 0, 0, theme).render(width)];
			while (lines.length && !lines[0].replace(ANSI, "").trim()) lines.shift();
			while (lines.length && !lines.at(-1)!.replace(ANSI, "").trim()) lines.pop();
			if (!lines.length) lines.push("");
			if (rows.length) rows.push({ text: "", plain: "", block: -1 });
			first[block.index] = rows.length;
			for (const text of lines) rows.push({ text, plain: text.replace(ANSI, ""), block: block.index });
			last[block.index] = rows.length - 1;
		}
		this.#layout = { width, rows, first, last };
		return this.#layout;
	}

	// ── geometry ────────────────────────────────────────────────────────

	#size(width: number): { rows: number; body: number; split: boolean; docW: number; sideW: number } {
		const rows = Math.max(8, this.#tui.terminal.rows);
		const split = width >= SPLIT_MIN_WIDTH && !this.#zoom;
		const docW = split ? Math.floor(width * DOC_SHARE) : width;
		const sideW = split ? width - docW - 1 : width;
		return { rows, body: Math.max(4, rows - 2 - this.#cardLines(width).length), split, docW, sideW };
	}

	/** Columns an answer gets in the normal split view; sent to the model so diagrams fit without zooming. */
	#answerWidth(): number {
		const columns = this.#tui.terminal.columns;
		if (columns < SPLIT_MIN_WIDTH) return columns - 2;
		return columns - Math.floor(columns * DOC_SHARE) - 1 - 2;
	}

	#contentWidth(docW: number): number {
		return Math.max(20, docW - GUTTER - 1);
	}

	#clampDoc(body: number): void {
		const rows = this.#layout?.rows.length ?? 0;
		this.#cursor = Math.max(0, Math.min(this.#cursor, rows - 1));
		this.#scroll = Math.max(0, Math.min(this.#scroll, Math.max(0, rows - body)));
	}

	#reveal(body: number): void {
		const margin = Math.min(SCROLL_MARGIN, Math.floor(body / 4));
		if (this.#cursor < this.#scroll + margin) this.#scroll = this.#cursor - margin;
		if (this.#cursor > this.#scroll + body - 1 - margin) this.#scroll = this.#cursor - body + 1 + margin;
		this.#clampDoc(body);
	}

	#bodyHeight(): number {
		const width = this.#tui.terminal.columns;
		return Math.max(4, this.#tui.terminal.rows - 2 - this.#cardLines(width).length);
	}

	#jumpToBlock(index: number): void {
		const layout = this.#layout;
		if (!layout || layout.first[index] === undefined) return;
		this.#cursor = layout.first[index];
		this.#scroll = this.#cursor - SCROLL_MARGIN;
		this.#reveal(this.#bodyHeight());
	}

	/** Rows covered by the selection, or by the block under the cursor when nothing is selected. */
	#selection(): Span | null {
		const layout = this.#layout;
		if (!layout?.rows.length) return null;
		if (this.#selAnchor !== null) {
			return { start: Math.min(this.#selAnchor, this.#cursor), end: Math.max(this.#selAnchor, this.#cursor) };
		}
		let row = this.#cursor;
		while (row < layout.rows.length - 1 && layout.rows[row].block < 0) row++;
		const block = layout.rows[row].block;
		return block < 0 ? null : { start: layout.first[block], end: layout.last[block] };
	}

	#anchorFor(span: Span): Anchor | null {
		const layout = this.#layout;
		if (!layout) return null;
		const covered = [...new Set(layout.rows.slice(span.start, span.end + 1).map(r => r.block).filter(b => b >= 0))];
		if (!covered.length) return null;
		const parts = covered.map(index => {
			const whole = layout.first[index] >= span.start && layout.last[index] <= span.end;
			if (whole) return this.#blocks[index].source;
			const table = this.#blocks[index].kind === "table";
			return layout.rows
				.slice(Math.max(span.start, layout.first[index]), Math.min(span.end, layout.last[index]) + 1)
				.map(r => r.plain)
				.filter(line => !BORDER_ONLY.test(line))
				.map(line => (table ? line.trim().replace(/^│\s?|\s?│$/g, "").replace(/\s*│\s*/g, " | ") : line).trimEnd())
				.join("\n");
		});
		const startIndex = covered[0];
		const endIndex = covered.at(-1)!;
		return {
			quote: parts.join("\n\n").trim().slice(0, 4000),
			startHash: this.#blocks[startIndex].hash,
			endHash: this.#blocks[endIndex].hash,
			startIndex,
			endIndex,
			version: this.#version,
			heading: this.#blocks[startIndex].headings.join(" › "),
		};
	}

	#flash(message: string): void {
		this.#message = message;
		this.#messageUntil = Date.now() + MESSAGE_MS;
	}

	// ── actions ─────────────────────────────────────────────────────────

	#close(): void {
		this.#tourHit("close");
		positions.set(this.#meta.slug, { cursor: this.#cursor, scroll: this.#scroll });
		this.#rt.store.markRead(this.#meta.slug, this.#version);
		this.#done();
	}

	#tourHit(event: TourEvent): void {
		if (this.#tour?.hit(event)) this.#tui.requestRender();
	}

	#startAsk(): void {
		const span = this.#selection();
		const anchor = span ? this.#anchorFor(span) : null;
		if (!anchor) {
			this.#flash("Nothing to ask about here");
			return;
		}
		this.#draft = anchor;
		this.#sideMode = "compose";
		this.#focus = "side";
		this.#browse = false;
		this.#composer = this.#newComposer("Type a question, or press 1-6 for a quick ask", question => this.#submitNew(question));
	}

	#quickAsk(preset: string): void {
		const span = this.#selection();
		const anchor = this.#sideMode === "compose" && this.#draft ? this.#draft : span ? this.#anchorFor(span) : null;
		const choice = PRESETS.find(p => p.key === preset);
		if (!anchor || !choice) return;
		this.#draft = anchor;
		this.#submitNew(choice.question);
	}

	#submitNew(question: string): void {
		const anchor = this.#draft;
		if (!anchor || !question.trim()) return;
		const thread = this.#rt.createThread(this.#meta.slug, anchor);
		this.#draft = null;
		this.#selAnchor = null;
		this.#openThread(thread);
		this.#rt.ask(this.#meta, thread, question.trim(), this.#version, this.#answerWidth());
		this.#tourHit("ask");
	}

	/** Show a thread with its follow-up box ready; `focusSide` false keeps the keyboard on the document. */
	#openThread(thread: Thread, focusSide = true): void {
		this.#showThread(thread);
		if (focusSide) this.#focus = "side";
		this.#browse = false;
		this.#stickBottom = true;
		const span = this.#resolve(thread.anchor);
		if (span) this.#jumpToBlock(span.start);
	}

	/** Make `thread` the side pane's thread, keeping a half-typed follow-up when it is already shown. */
	#showThread(thread: Thread): void {
		const same = this.#threadId === thread.id && this.#sideMode === "thread" && this.#composer;
		this.#threadId = thread.id;
		this.#sideMode = "thread";
		if (!same) this.#composer = this.#newComposer("Ask a follow-up…", question => this.#sendFollowUp(thread, question));
	}

	#currentThread(): Thread | undefined {
		return this.#threads().find(t => t.id === this.#threadId);
	}

	/** A multi-line question box: Enter sends, Shift+Enter (or Alt+Enter) starts a new line, like the chat composer. */
	#newComposer(placeholder: string, onSubmit: (value: string) => void): Editor {
		const editor = new Editor(getEditorTheme());
		editor.focused = true;
		editor.placeholder = () => placeholder;
		editor.setMaxHeight(8);
		editor.onSubmit = value => {
			if (value.trim()) onSubmit(value);
		};
		return editor;
	}

	/** Keys go to the question box: asking about a passage, or a thread not in browse mode. */
	#composerActive(): boolean {
		if (!this.#composer || this.#focus !== "side") return false;
		return this.#sideMode === "compose" || (this.#sideMode === "thread" && !this.#browse);
	}

	#cancelCompose(): void {
		this.#draft = null;
		this.#focus = "doc";
		const thread = this.#currentThread();
		if (thread) {
			this.#sideMode = "list";
			this.#showThread(thread);
		} else {
			this.#composer = null;
			this.#sideMode = "list";
		}
	}

	#sendFollowUp(thread: Thread, question: string): void {
		if (this.#rt.isRunning(thread.id)) {
			// The box clears itself on Enter; put the question back so it is not lost.
			this.#composer?.setText(question);
			this.#flash("Wait for this answer to finish (Esc, then c cancels it)");
			return;
		}
		this.#stickBottom = true;
		this.#rt.ask(this.#meta, thread, question.trim(), this.#version, this.#answerWidth());
		this.#tourHit("followup");
	}

	#copy(text: string, what: string): void {
		copyToClipboard(text).then(
			() => {
				this.#flash(`Copied ${what}`);
				this.#tui.requestRender();
			},
			(error: unknown) => {
				this.#flash(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
				this.#tui.requestRender();
			},
		);
	}

	#sendToChat(thread: Thread): void {
		const quote = thread.anchor.quote.split("\n").slice(0, 4).map(line => `> ${line}`).join("\n");
		const text = [
			`Side thread on “${this.#meta.title}”${thread.anchor.heading ? `, ${thread.anchor.heading}` : ""}:`,
			quote,
			"",
			...thread.turns.flatMap(t => [`Q: ${t.q}`, `A: ${t.a.trim() || `(${t.status})`}`, ""]),
		].join("\n");
		this.#rt.ctx.ui.pasteToEditor(text);
		this.#flash("Pasted into the chat composer. It is not sent; close the reader to edit and send it.");
	}

	#runSearch(query: string): void {
		const layout = this.#layout;
		this.#search = null;
		if (!layout || !query.trim()) return;
		const needle = query.toLowerCase();
		this.#tourHit("search");
		this.#matches = layout.rows.flatMap((row, index) => (row.plain.toLowerCase().includes(needle) ? [index] : []));
		if (!this.#matches.length) {
			this.#flash(`No match for “${query}”`);
			return;
		}
		const next = this.#matches.findIndex(row => row >= this.#cursor);
		this.#matchIndex = next >= 0 ? next : 0;
		this.#gotoMatch();
	}

	#gotoMatch(): void {
		if (!this.#matches.length) return;
		this.#cursor = this.#matches[this.#matchIndex];
		this.#reveal(this.#bodyHeight());
		this.#flash(`Match ${this.#matchIndex + 1}/${this.#matches.length}`);
	}

	/** Step the cursor to the next/previous block satisfying `test`. */
	#jumpBlock(direction: 1 | -1, test: (block: Block) => boolean, label: string): void {
		const layout = this.#layout;
		if (!layout) return;
		const here = layout.rows[this.#cursor]?.block ?? -1;
		const from = here < 0 ? (direction > 0 ? -1 : this.#blocks.length) : here;
		for (let i = from + direction; i >= 0 && i < this.#blocks.length; i += direction) {
			if (test(this.#blocks[i])) {
				this.#jumpToBlock(i);
				return;
			}
		}
		this.#flash(`No ${direction > 0 ? "next" : "previous"} ${label}`);
	}

	// ── input ───────────────────────────────────────────────────────────

	handleInput(data: string): void {
		if (data.startsWith("\x1b[<")) {
			const event = parseSgrMouse(data);
			if (event) this.#handleMouse(event);
			return;
		}
		if (this.#search) {
			this.#search.handleInput(data);
			this.#tui.requestRender();
			return;
		}
		if (this.#offer) {
			this.#offer = false;
			if (matchesKey(data, "enter")) {
				this.#close();
				this.#onStartTour?.();
				return;
			}
			this.#tui.requestRender();
			// Esc only dismisses the card; any other key also does what it normally does.
			if (matchesKey(data, "escape")) return;
		}
		if (this.#composerActive() && this.#composer) {
			this.#handleComposerKey(this.#composer, data);
			this.#tui.requestRender();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.#focus = this.#focus === "doc" ? "side" : "doc";
			// Coming back to a thread puts you straight into its follow-up box.
			if (this.#focus === "side") this.#browse = false;
		} else if (data === "z") {
			if (this.#tui.terminal.columns < SPLIT_MIN_WIDTH) this.#flash("Already showing one pane at full width");
			else this.#zoom = !this.#zoom;
			this.#tourHit("zoom");
		} else if (data === "?") {
			if (this.#sideMode === "help") this.#sideMode = this.#helpReturn;
			else {
				this.#helpReturn = this.#sideMode;
				this.#sideMode = "help";
				this.#focus = "side";
				this.#sideScroll = 0;
				this.#tourHit("help");
			}
		} else if (data === "q") {
			this.#close();
			return;
		} else if (this.#focus === "doc") {
			if (this.#handleDocKey(data)) return;
		} else {
			if (this.#handleSideKey(data)) return;
		}
		this.#tui.requestRender();
	}

	#handleComposerKey(composer: Editor, data: string): void {
		const empty = composer.getText() === "";
		if (matchesKey(data, "escape")) {
			// Asking: Esc abandons the question. In a thread: Esc steps out of the box, into browse mode.
			if (this.#sideMode === "compose") this.#cancelCompose();
			else {
				this.#browse = true;
				this.#tourHit("browse");
			}
		} else if (matchesKey(data, "tab")) {
			this.#focus = "doc";
		} else if (this.#sideMode === "compose" && empty && PRESETS.some(p => p.key === data)) {
			this.#quickAsk(data);
		} else if (this.#sideMode === "thread" && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) {
			const page = this.#bodyHeight() - 4;
			this.#scrollSide(matchesKey(data, "pageUp") ? -page : page);
		} else {
			composer.handleInput(data);
		}
	}

	/** Returns true when the reader closed. */
	#handleDocKey(data: string): boolean {
		const body = this.#bodyHeight();
		const rows = this.#layout?.rows.length ?? 0;
		const move = (to: number): void => {
			this.#cursor = to;
			this.#reveal(body);
		};
		if (data === "j" || matchesKey(data, "down")) move(this.#cursor + 1);
		else if (data === "k" || matchesKey(data, "up")) move(this.#cursor - 1);
		else if (data === " " || matchesKey(data, "pageDown")) move(this.#cursor + body - 2);
		else if (data === "b" || matchesKey(data, "pageUp")) move(this.#cursor - body + 2);
		else if (data === "g" || matchesKey(data, "home")) move(0);
		else if (data === "G" || matchesKey(data, "end")) move(rows - 1);
		else if (data === "]" || data === "[") {
			this.#jumpBlock(data === "]" ? 1 : -1, () => true, "block");
			this.#tourHit("block");
		} else if (data === "}" || data === "{") {
			this.#jumpBlock(data === "}" ? 1 : -1, b => b.kind === "heading", "section");
			this.#tourHit("section");
		}
		else if (data === "d") this.#jumpBlock(1, b => this.#changed.has(b.index), "change");
		else if (data === "D") this.#jumpBlock(-1, b => this.#changed.has(b.index), "change");
		else if (data === "t" || data === "T") this.#jumpThread(data === "t" ? 1 : -1);
		else if (data === "v") this.#selAnchor = this.#selAnchor === null ? this.#cursor : null;
		else if (data === "V") this.#selectBlock();
		else if (data === "a" || matchesKey(data, "enter")) this.#startAsk();
		else if (PRESETS.some(p => p.key === data)) this.#quickAsk(data);
		else if (data === "y") {
			const span = this.#selection();
			const anchor = span ? this.#anchorFor(span) : null;
			if (anchor) this.#copy(anchor.quote, "passage");
		} else if (data === "o") {
			this.#sideMode = this.#sideMode === "outline" ? "list" : "outline";
			this.#focus = "side";
			if (this.#sideMode === "outline") this.#tourHit("outline");
		} else if (data === "/") {
			const search = new Input();
			search.focused = true;
			search.onSubmit = value => this.#runSearch(value);
			search.onEscape = () => {
				this.#search = null;
			};
			this.#search = search;
		} else if (data === "n" && this.#matches.length) {
			this.#matchIndex = (this.#matchIndex + 1) % this.#matches.length;
			this.#gotoMatch();
		} else if (data === "N" && this.#matches.length) {
			this.#matchIndex = (this.#matchIndex - 1 + this.#matches.length) % this.#matches.length;
			this.#gotoMatch();
		} else if (matchesKey(data, "escape")) {
			if (this.#selAnchor !== null) this.#selAnchor = null;
			else if (this.#matches.length) this.#matches = [];
			else {
				this.#close();
				return true;
			}
		}
		return false;
	}

	#selectBlock(): void {
		const layout = this.#layout;
		const block = layout?.rows[this.#cursor]?.block ?? -1;
		if (!layout || block < 0) return;
		this.#selAnchor = layout.first[block];
		this.#cursor = layout.last[block];
	}

	#jumpThread(direction: 1 | -1): void {
		const located = this.#orderedThreads().filter(t => t.span);
		if (!located.length) {
			this.#flash("No threads in this document yet");
			return;
		}
		const here = this.#layout?.rows[this.#cursor]?.block ?? -1;
		const sorted = [...located].sort((a, b) => a.span!.start - b.span!.start);
		const next =
			direction > 0
				? (sorted.find(t => t.span!.start > here) ?? sorted[0])
				: ([...sorted].reverse().find(t => t.span!.start < here) ?? sorted.at(-1)!);
		this.#openThread(next.thread, false);
	}

	/** Returns true when the reader closed. */
	#handleSideKey(data: string): boolean {
		const escape = matchesKey(data, "escape");
		if (this.#sideMode === "help") {
			if (data === "j" || matchesKey(data, "down")) this.#sideScroll++;
			else if (data === "k" || matchesKey(data, "up")) this.#sideScroll = Math.max(0, this.#sideScroll - 1);
			else if (escape) {
				this.#sideMode = this.#helpReturn;
				this.#stickBottom = true;
			}
			return false;
		}
		if (this.#sideMode === "outline") {
			const heads = this.#blocks.filter(b => b.kind === "heading");
			if (data === "j" || matchesKey(data, "down")) this.#outlineIndex = Math.min(heads.length - 1, this.#outlineIndex + 1);
			else if (data === "k" || matchesKey(data, "up")) this.#outlineIndex = Math.max(0, this.#outlineIndex - 1);
			else if (matchesKey(data, "enter") && heads[this.#outlineIndex]) {
				this.#jumpToBlock(heads[this.#outlineIndex].index);
				this.#focus = "doc";
			} else if (escape || data === "o") {
				this.#sideMode = this.#threadId ? "thread" : "list";
				this.#focus = "doc";
			}
			return false;
		}
		if (this.#sideMode === "list") {
			const items = this.#orderedThreads();
			if (data === "j" || matchesKey(data, "down")) this.#listIndex = Math.min(items.length - 1, this.#listIndex + 1);
			else if (data === "k" || matchesKey(data, "up")) this.#listIndex = Math.max(0, this.#listIndex - 1);
			else if (matchesKey(data, "enter") && items[this.#listIndex]) this.#openThread(items[this.#listIndex].thread);
			else if (data === "r" && items[this.#listIndex]) {
				const { thread } = items[this.#listIndex];
				this.#rt.setResolved(this.#meta.slug, thread, !thread.resolved);
			} else if (data === "x" && items[this.#listIndex]) this.#deleteThread(items[this.#listIndex].thread);
			else if (escape) this.#focus = "doc";
			return false;
		}
		if (this.#sideMode === "thread") {
			const thread = this.#currentThread();
			if (!thread) {
				this.#sideMode = "list";
				return false;
			}
			const page = this.#bodyHeight() - 4;
			if (data === "j" || matchesKey(data, "down")) this.#scrollSide(1);
			else if (data === "k" || matchesKey(data, "up")) this.#scrollSide(-1);
			else if (data === " " || matchesKey(data, "pageDown")) this.#scrollSide(page);
			else if (data === "b" || matchesKey(data, "pageUp")) this.#scrollSide(-page);
			else if (data === "f" || data === "i" || matchesKey(data, "enter")) this.#browse = false;
			else if (data === "p") this.#sendToChat(thread);
			else if (data === "y") {
				const last = [...thread.turns].reverse().find(t => t.a.trim());
				if (last) this.#copy(last.a, "answer");
			} else if (data === "r") {
				this.#rt.setResolved(this.#meta.slug, thread, !thread.resolved);
				this.#flash(thread.resolved ? "Resolved" : "Reopened");
			} else if (data === "x") this.#deleteThread(thread);
			else if (data === "c") this.#flash(this.#rt.cancel(thread.id) ? "Cancelled" : "Nothing running in this thread");
			else if (escape) {
				// The answer keeps streaming in the background; the list shows it under "Answering".
				this.#sideMode = "list";
				this.#composer = null;
				this.#threadId = null;
				this.#tourHit("list");
			}
		}
		return false;
	}

	#deleteThread(thread: Thread): void {
		if (Date.now() > this.#armDelete) {
			this.#armDelete = Date.now() + 2000;
			this.#flash("Press x again to delete this thread");
			return;
		}
		this.#armDelete = 0;
		this.#rt.deleteThread(this.#meta.slug, thread);
		if (this.#threadId === thread.id) {
			this.#threadId = null;
			this.#sideMode = "list";
		}
		this.#listIndex = Math.max(0, this.#listIndex - 1);
		this.#flash("Thread deleted");
	}

	#scrollSide(delta: number): void {
		this.#sideScroll = Math.max(0, this.#sideScroll + delta);
		this.#stickBottom = false;
	}

	#handleMouse(event: SgrMouseEvent): void {
		const { split, docW, body } = this.#size(this.#tui.terminal.columns);
		const inBody = event.row >= 1 && event.row <= body;
		const onDoc = split ? event.col < docW : this.#focus === "doc";
		const docRow = this.#scroll + event.row - 1;
		const layout = this.#layout;

		if (event.wheel !== null) {
			if (onDoc) {
				this.#scroll += event.wheel * WHEEL_STEP;
				this.#clampDoc(body);
				if (this.#cursor < this.#scroll) this.#cursor = this.#scroll;
				if (this.#cursor > this.#scroll + body - 1) this.#cursor = this.#scroll + body - 1;
			} else {
				this.#scrollSide(event.wheel * WHEEL_STEP);
			}
		} else if (event.leftClick && inBody) {
			if (onDoc && layout && docRow < layout.rows.length) {
				this.#focus = "doc";
				const now = Date.now();
				if (now - this.#lastClick.at < DOUBLE_CLICK_MS && this.#lastClick.row === docRow) {
					this.#cursor = docRow;
					this.#selectBlock();
					this.#dragging = false;
				} else {
					this.#cursor = docRow;
					this.#selAnchor = docRow;
					this.#dragging = true;
				}
				this.#lastClick = { at: now, row: docRow };
			} else if (!onDoc) {
				this.#focus = "side";
				this.#browse = false;
				const hit = this.#sideHits.find(h => h.row === event.row - 1);
				if (hit && this.#sideMode === "list") {
					const item = this.#orderedThreads()[hit.index];
					this.#listIndex = hit.index;
					if (item) this.#openThread(item.thread);
				} else if (hit && this.#sideMode === "outline") {
					const head = this.#blocks.filter(b => b.kind === "heading")[hit.index];
					if (head) this.#jumpToBlock(head.index);
				}
			}
		} else if (event.motion) {
			const dragging = (event.button & 3) === 0;
			if (dragging && this.#dragging && layout) {
				if (event.row < 1) this.#scroll = Math.max(0, this.#scroll - 1);
				if (event.row > body) this.#scroll += 1;
				this.#clampDoc(body);
				this.#cursor = Math.max(0, Math.min(layout.rows.length - 1, this.#scroll + Math.max(0, Math.min(body - 1, event.row - 1))));
			} else if (onDoc && inBody && layout) {
				this.#hoverBlock = layout.rows[docRow]?.block ?? -1;
			} else {
				this.#hoverBlock = -1;
			}
		} else if (event.release && this.#dragging) {
			this.#dragging = false;
			if (this.#selAnchor === this.#cursor) this.#selAnchor = null;
		}
		this.#tui.requestRender();
	}

	// ── render ──────────────────────────────────────────────────────────

	render(width: number): readonly string[] {
		const size = this.#size(width);
		const { body, split, docW, sideW } = size;
		const layout = this.#layoutFor(this.#contentWidth(docW));
		this.#clampDoc(body);
		this.#tick();

		const showDoc = split || this.#focus === "doc";
		const showSide = split || this.#focus === "side";
		const doc = showDoc ? this.#renderDoc(layout, docW, body) : [];
		const side = showSide ? this.#renderSide(split ? sideW : width, body) : [];
		const divider = this.#theme.fg("borderMuted", "│");

		const lines: string[] = [this.#renderTop(width, layout)];
		for (let i = 0; i < body; i++) {
			if (split) lines.push(`${doc[i] ?? fit("", docW)}${divider}${side[i] ?? fit("", sideW)}`);
			else lines.push(showDoc ? (doc[i] ?? "") : (side[i] ?? ""));
		}
		lines.push(...this.#cardLines(width), this.#renderBottom(width));
		return lines;
	}

	/** Keep spinners moving while any answer streams, and drop loaders of answers that finished. */
	#tick(): void {
		const running = this.#threads().some(thread => this.#rt.isRunning(thread.id));
		if (running && !this.#ticker) this.#ticker = setInterval(() => this.#tui.requestRender(), SPINNER_ADVANCE_MS);
		else if (!running && this.#ticker) {
			clearInterval(this.#ticker);
			this.#ticker = undefined;
		}
		// Tour steps that are states rather than single keys.
		if (this.#selAnchor !== null && this.#selAnchor !== this.#cursor) this.#tourHit("select");
		const newest = this.#threads().at(-1)?.turns.at(-1);
		if (this.#tour?.current?.on === "answer" && newest && newest.status !== "running") this.#tourHit("answer");
		for (const [id, loader] of this.#loaders) {
			if (this.#rt.isRunning(id)) continue;
			loader.dispose();
			this.#loaders.delete(id);
		}
	}

	#renderTop(width: number, layout: Layout): string {
		const t = this.#theme;
		const versions = this.#meta.versions.length;
		const changes = this.#changed.size ? ` · ${this.#changed.size} changed since v${this.#meta.lastRead}` : "";
		const note = this.#meta.versions.at(-1)?.note;
		const left = `${t.bold(t.fg("accent", ` ${this.#meta.title}`))}${t.fg("muted", ` · v${this.#version}${versions > 1 ? `/${versions}` : ""}${changes}${note ? ` · ${note}` : ""}`)}`;
		const total = layout.rows.length;
		const pct = total ? Math.round((Math.min(this.#scroll + this.#bodyHeight(), total) / total) * 100) : 100;
		const open = this.#threads().filter(th => !th.resolved).length;
		const zoomed = this.#zoom ? `zoomed ${this.#focus === "doc" ? "document" : "threads"} (z) · ` : "";
		const right = t.fg("muted", `${zoomed}${pct}% · ${open} open thread${open === 1 ? "" : "s"} `);
		const space = width - visibleWidth(right);
		return `${fit(left, space)}${right}`;
	}

	#renderBottom(width: number): string {
		const t = this.#theme;
		if (this.#search) return fit(`${t.fg("accent", "/")}${this.#search.render(width - 1)[0] ?? ""}`, width);
		if (this.#message && Date.now() < this.#messageUntil) return fit(t.fg("warning", ` ${this.#message}`), width);
		let hint: string;
		const quick = PRESETS.map(p => `${p.key} ${p.label}`).join(" ");
		if (this.#composerActive()) {
			hint =
				this.#sideMode === "compose"
					? `Enter ask · Shift+Enter new line · 1-${PRESETS.length} quick ask (empty box) · Esc cancel · Tab doc`
					: "Enter send · Shift+Enter new line · PgUp/PgDn scroll · Esc browse (copy, resolve…) · Tab doc";
		} else if (this.#focus === "doc") {
			hint =
				this.#selAnchor !== null
					? `a ask · ${quick} · y copy · Esc clear`
					: `? all keys · j/k move · [ ] block · { } section · v select · a ask · 1-${PRESETS.length} quick ask · d change · t thread · / search · o outline · z zoom · Tab side · q close`;
		} else if (this.#sideMode === "thread") hint = "f type a follow-up · j/k scroll · c cancel answer · p send to chat · y copy · r resolve · x delete · Esc back · Tab doc";
		else if (this.#sideMode === "outline") hint = "j/k pick · Enter jump · Esc back · Tab doc";
		else hint = "? all keys · j/k pick · Enter open · r resolve · x delete · Tab doc · q close";
		return fit(t.fg("dim", ` ${hint}`), width);
	}

	#renderDoc(layout: Layout, docW: number, body: number): string[] {
		const t = this.#theme;
		const contentW = this.#contentWidth(docW);
		const sel = this.#selAnchor !== null ? this.#selection() : null;
		const markers = new Map<number, Group>();
		const rank = (group: Group): number => GROUPS.findIndex(g => g.group === group);
		for (const { span, group } of this.#orderedThreads()) {
			if (!span) continue;
			const held = markers.get(span.start);
			if (held === undefined || rank(group) < rank(held)) markers.set(span.start, group);
		}
		const out: string[] = [];
		for (let i = 0; i < body; i++) {
			const index = this.#scroll + i;
			const row = layout.rows[index];
			if (!row) {
				out.push(fit("", docW));
				continue;
			}
			const changed = row.block >= 0 && this.#changed.has(row.block) ? t.fg("accent", "▎") : " ";
			const marker = row.block >= 0 && layout.first[row.block] === index ? markers.get(row.block) : undefined;
			const thread = marker ? this.#icon(marker) : " ";
			const isCursor = index === this.#cursor && this.#focus === "doc";
			const hovered = row.block >= 0 && row.block === this.#hoverBlock;
			const caret = isCursor ? t.fg("accent", "›") : hovered ? t.fg("dim", "┃") : " ";
			const selected = sel !== null && index >= sel.start && index <= sel.end;
			const content = selected ? highlightRow(row.text, contentW, s => t.bg("selectedBg", s)) : fit(row.text, contentW);
			out.push(`${changed}${thread}${caret}${content} `);
		}
		return out;
	}

	#renderSide(width: number, body: number): string[] {
		const inner = width - 2;
		let lines: string[];
		this.#sideHits = [];
		if (this.#sideMode === "help") lines = this.#renderHelp(inner);
		else if (this.#sideMode === "outline") lines = this.#renderOutline(inner);
		else if (this.#sideMode === "compose") lines = this.#renderCompose(inner);
		else if (this.#sideMode === "thread") lines = this.#renderThread(inner);
		else lines = this.#renderList(inner);

		// The question box stays pinned at the bottom; only what is above it scrolls.
		const footer = this.#sideMode === "compose" || this.#sideMode === "thread" ? this.#composerFooter(inner) : [];
		const room = Math.max(3, body - footer.length);
		if (this.#sideMode === "thread") {
			const max = Math.max(0, lines.length - room);
			if (this.#stickBottom) this.#sideScroll = max;
			this.#sideScroll = Math.min(this.#sideScroll, max);
			if (this.#sideScroll >= max) this.#stickBottom = true;
			lines = lines.slice(this.#sideScroll);
		} else if (this.#sideMode === "help") {
			this.#sideScroll = Math.min(this.#sideScroll, Math.max(0, lines.length - room));
			lines = lines.slice(this.#sideScroll);
		}
		lines = [...lines.slice(0, room), ...Array<string>(Math.max(0, room - lines.length)).fill(""), ...footer];
		const out: string[] = [];
		for (let i = 0; i < body; i++) out.push(` ${fit(lines[i] ?? "", inner)} `);
		return out;
	}

	/** The pinned question box, with a hint when it is not taking keys. */
	#composerFooter(width: number): string[] {
		const composer = this.#composer;
		if (!composer) return [];
		const t = this.#theme;
		const active = this.#composerActive();
		composer.focused = active;
		const hint = active
			? []
			: [t.fg("dim", this.#focus === "side" ? "f or Enter to type a follow-up" : "Tab to type a follow-up")];
		return [...hint, ...composer.render(width)];
	}

	#heading(text: string): string {
		const t = this.#theme;
		const focused = this.#focus === "side";
		return t.bold(t.fg(focused ? "accent" : "muted", text));
	}

	#renderList(width: number): string[] {
		const t = this.#theme;
		const items = this.#orderedThreads();
		const lines = [this.#heading(`Threads (${items.length})`), ""];
		if (!items.length) {
			lines.push(
				t.fg("muted", "No questions yet."),
				"",
				t.fg("muted", "Select a passage (v, or drag with the mouse),"),
				t.fg("muted", `then press a to ask or 1-${PRESETS.length} for a quick ask:`),
				"",
				...PRESETS.map(p => t.fg("dim", `  ${p.key}  ${p.label}`)),
			);
			return lines;
		}
		this.#listIndex = Math.min(this.#listIndex, items.length - 1);
		let section: Group | undefined;
		items.forEach(({ thread, span, group }, index) => {
			if (group !== section) {
				section = group;
				const title = GROUPS.find(g => g.group === group)?.title ?? group;
				const count = items.filter(item => item.group === group).length;
				lines.push(`${this.#icon(group)} ${t.bold(t.fg("muted", `${title} (${count})`))}`);
			}
			const kind = presetFor(thread.turns[0]?.q ?? "")?.label ?? "your question";
			const latest = thread.turns.at(-1)?.q ?? "";
			const shown = presetFor(latest) ? `${presetFor(latest)!.label} (quick ask)` : latest;
			const unseen = this.#rt.unseen(thread);
			const meta = [
				`${thread.turns.length} question${thread.turns.length === 1 ? "" : "s"}`,
				...(unseen ? [`${unseen} new`] : []),
				...(!span && group !== "outdated" ? ["passage changed"] : []),
			].join(" · ");
			const selected = index === this.#listIndex && this.#focus === "side";
			const rowsFor = [
				`  ${t.bold(thread.anchor.heading || "passage")}${t.fg("dim", ` · ${kind}`)}`,
				`  ${t.fg("mdQuote", `“${normalizeText(thread.anchor.quote).slice(0, width)}”`)}`,
				`  ${t.fg("muted", shown.replace(/\s+/g, " ").slice(0, width - 4))}${t.fg("dim", ` · ${meta}`)}`,
			];
			for (const text of rowsFor) {
				this.#sideHits.push({ row: lines.length, index });
				lines.push(selected ? t.bg("selectedBg", fit(text.replace(ANSI, ""), width)) : text);
			}
			lines.push("");
		});
		return lines;
	}

	/** Every key, grouped; j/k scroll when it is taller than the pane. */
	#renderHelp(width: number): string[] {
		const t = this.#theme;
		const keyW = Math.min(20, Math.floor(width * 0.35));
		const lines = [this.#heading("Keys"), t.fg("dim", "? or Esc closes · j/k scroll"), ""];
		for (const section of HELP) {
			lines.push(t.bold(t.fg("accent", section.title)));
			for (const [keys, what] of section.keys) {
				const wrapped = wrapTextWithAnsi(what, Math.max(10, width - keyW - 2));
				wrapped.forEach((line, i) => lines.push(`${i === 0 ? t.fg("text", keys.padEnd(keyW)) : " ".repeat(keyW)}  ${t.fg("muted", line)}`));
			}
			lines.push("");
		}
		return lines.map(line => truncateToWidth(line, width));
	}

	/** The card above the bottom bar: the one-time tour offer, or the current tour step. */
	#cardLines(width: number): string[] {
		const t = this.#theme;
		const rule = (label: string): string => {
			const head = `── ${label} `;
			return `${t.bold(t.fg("accent", head))}${t.fg("borderMuted", "─".repeat(Math.max(0, width - visibleWidth(head))))}`;
		};
		const body = (text: string): string[] =>
			wrapTextWithAnsi(text, width - 2)
				.slice(0, 3)
				.map(line => ` ${t.fg("text", line)}`);
		if (this.#offer) {
			return [
				rule("◆ New to the reader?"),
				...body("Press Enter for a 2-minute guided tour of every feature, or any other key to start reading. Replay it any time with /read tour."),
			];
		}
		const step = this.#tour?.current;
		if (!this.#tour || !step) return [];
		const ticked = Date.now() - this.#tour.doneAt < 1500 ? " ✓" : "";
		return [rule(`◆ Tour ${this.#tour.step + 1}/${TOUR_STEPS.length}${ticked}`), ...body(step.text)];
	}

	#renderOutline(width: number): string[] {
		const t = this.#theme;
		const heads = this.#blocks.filter(b => b.kind === "heading");
		const here = this.#layout?.rows[this.#cursor]?.block ?? 0;
		const current = heads.reduce((found, head, index) => (head.index <= here ? index : found), 0);
		const lines = [this.#heading("Outline"), ""];
		heads.forEach((head, index) => {
			const changed = this.#changed.has(head.index) ? t.fg("accent", "▎") : " ";
			const label = `${"  ".repeat(head.level - 1)}${head.headings.at(-1) ?? ""}`;
			const mark = index === current ? t.fg("accent", "◆ ") : "  ";
			this.#sideHits.push({ row: lines.length, index });
			const text = `${changed}${mark}${label}`;
			lines.push(index === this.#outlineIndex && this.#focus === "side" ? t.bg("selectedBg", fit(text.replace(ANSI, ""), width)) : text);
		});
		return lines.map(line => truncateToWidth(line, width));
	}

	#quoteBox(quote: string, width: number): string[] {
		const t = this.#theme;
		const wrapped = quote.split("\n").flatMap(line => wrapTextWithAnsi(line, width - 2));
		const shown = wrapped.slice(0, QUOTE_PREVIEW_LINES);
		if (wrapped.length > shown.length) shown.push("…");
		return shown.map(line => `${t.fg("mdQuoteBorder", "▎")} ${t.fg("mdQuote", line)}`);
	}

	#renderCompose(width: number): string[] {
		const t = this.#theme;
		const anchor = this.#draft;
		const lines = [this.#heading("Ask about this passage"), ""];
		if (anchor) {
			if (anchor.heading) lines.push(t.fg("muted", `§ ${anchor.heading}`));
			lines.push(...this.#quoteBox(anchor.quote, width), "");
		}
		lines.push(t.fg("muted", "Type a question below, or press a number:"));
		for (const preset of PRESETS) lines.push(t.fg("dim", `  ${preset.key}  ${preset.label}`));
		return lines;
	}

	#renderThread(width: number): string[] {
		const t = this.#theme;
		const thread = this.#currentThread();
		if (!thread) return [];
		const span = this.#resolve(thread.anchor);
		const lines = [this.#heading(thread.anchor.heading ? `§ ${thread.anchor.heading}` : "Passage")];
		if (!span) lines.push(t.fg("warning", "△ This passage changed; the thread is outdated."));
		else if (thread.resolved) lines.push(t.fg("success", "✓ Resolved"));
		lines.push("", ...this.#quoteBox(thread.anchor.quote, width), "");
		const theme = getMarkdownTheme();
		thread.turns.forEach((turn, index) => {
			// Your question in the same filled bubble the main chat uses; the answer as plain text below it.
			const qKey = `q:${thread.id}:${index}:${width}`;
			let bubble = this.#answerCache.get(qKey);
			if (!bubble) {
				bubble = [
					...new Markdown(turn.q, 1, 1, theme, {
						bgColor: s => t.bg("userMessageBg", s),
						color: s => t.fgOnBg("userMessageText", "userMessageBg", s),
					}).render(width),
				];
				this.#answerCache.set(qKey, bubble);
			}
			lines.push(...bubble, "");
			const key = `${thread.id}:${index}:${turn.a.length}:${width}`;
			let answer = this.#answerCache.get(key);
			if (!answer && turn.a) {
				answer = [...new Markdown(turn.a, 0, 0, theme).render(width)];
				this.#answerCache.set(key, answer);
			}
			if (answer) lines.push(...answer);
			if (turn.status === "running") lines.push(...this.#loaderFor(thread.id).render(width));
			else if (turn.status === "cancelled") lines.push(t.fg("dim", "(cancelled)"));
			else if (turn.status === "interrupted") lines.push(t.fg("warning", "(interrupted before it finished)"));
			else if (turn.status === "error") lines.push(...wrapTextWithAnsi(t.fg("error", `Error: ${turn.error ?? "unknown"}`), width));
			lines.push("");
		});
		this.#rt.markSeen(this.#meta.slug, thread);
		return lines.map(line => truncateToWidth(line, width));
	}

	/** omp's own working indicator (spinner, shimmering "Working…"), one per streaming thread. */
	#loaderFor(threadId: string): Loader {
		let loader = this.#loaders.get(threadId);
		if (!loader) {
			const t = this.#theme;
			const message = Object.assign((text: string) => shimmerText(text, t), { animated: true as const });
			loader = new Loader(this.#tui, spinner => t.fg("accent", spinner), message, WORKING_MESSAGE, getSymbolTheme().spinnerFrames);
			this.#loaders.set(threadId, loader);
		}
		return loader;
	}

	invalidate(): void {
		this.#layout = undefined;
		this.#answerCache.clear();
	}

	dispose(): void {
		this.#unsubscribe();
		clearInterval(this.#ticker);
		for (const loader of this.#loaders.values()) loader.dispose();
		this.#loaders.clear();
		this.#rt.readerOpen = false;
	}
}
