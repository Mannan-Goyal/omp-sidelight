/**
 * Lightweight editable text field for Sidelight's embedded boxes (the single-line
 * search prompt and the multi-line question/follow-up composer).
 *
 * Renders to ANSI-styled terminal rows via `@oh-my-pi/pi-tui/text/width` and
 * decodes terminal input via `@oh-my-pi/pi-tui/driver/input/keys`.
 */
import type { ExtensionTheme } from "@oh-my-pi/pi-coding-agent";
import { decodeKey, type KeyDecodeContext } from "@oh-my-pi/pi-tui/driver/input/keys";
import { replaceTabs, truncate, visibleWidth, wrap } from "@oh-my-pi/pi-tui/text/width";

const KEY_CTX: KeyDecodeContext = { kitty: true, backspaceIsCtrl: false };
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function prevGrapheme(text: string, offset: number): number {
	if (offset <= 0) return 0;
	const from = Math.max(0, offset - 64);
	let last = from;
	for (const seg of segmenter.segment(text.slice(from, offset))) last = from + seg.index;
	return last;
}

function nextGrapheme(text: string, offset: number): number {
	if (offset >= text.length) return text.length;
	const slice = text.slice(offset, Math.min(text.length, offset + 64));
	for (const seg of segmenter.segment(slice)) return offset + seg.segment.length;
	return text.length;
}

function prevWord(text: string, offset: number): number {
	let i = offset;
	while (i > 0 && /\s/.test(text[i - 1]!)) i--;
	while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
	return i;
}

function nextWord(text: string, offset: number): number {
	let i = offset;
	while (i < text.length && /\s/.test(text[i]!)) i++;
	while (i < text.length && !/\s/.test(text[i]!)) i++;
	return i;
}

function lineStart(text: string, offset: number): number {
	const nl = text.lastIndexOf("\n", Math.max(0, offset - 1));
	return nl === -1 ? 0 : nl + 1;
}

function lineEnd(text: string, offset: number): number {
	const nl = text.indexOf("\n", offset);
	return nl === -1 ? text.length : nl;
}

/** Decode one raw terminal sequence into its canonical key id, or null if not a key. */
export function keyIdOf(data: string): string | null {
	return decodeKey(data, KEY_CTX)?.id ?? null;
}

/** Extract bracketed paste payload, or null when `data` is not a bracketed paste. */
function unpackPaste(data: string): string | null {
	if (!data.startsWith(BRACKETED_PASTE_START)) return null;
	const body = data.endsWith(BRACKETED_PASTE_END)
		? data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length)
		: data.slice(BRACKETED_PASTE_START.length);
	return body.replace(/\r\n?/g, "\n");
}

export interface TextFieldOptions {
	readonly multiline: boolean;
	readonly placeholder?: string;
	readonly maxHeight?: number;
	readonly onSubmit?: (value: string) => void;
	readonly onEscape?: () => void;
}

/** Single-line (`Input`) or multi-line (`Editor`) text box painted as terminal rows. */
export class TextField {
	focused = true;
	#text = "";
	#cursor = 0;
	readonly #multiline: boolean;
	readonly #placeholder: string;
	readonly #maxHeight: number;
	readonly #onSubmit?: (value: string) => void;
	readonly #onEscape?: () => void;

	constructor(options: TextFieldOptions) {
		this.#multiline = options.multiline;
		this.#placeholder = options.placeholder ?? "";
		this.#maxHeight = options.maxHeight ?? 8;
		this.#onSubmit = options.onSubmit;
		this.#onEscape = options.onEscape;
	}

	getText(): string {
		return this.#text;
	}

	setText(text: string): void {
		this.#text = this.#multiline ? text.replace(/\r\n?/g, "\n") : text.replace(/[\r\n]+/g, " ");
		this.#cursor = this.#text.length;
	}

	handleInput(data: string): void {
		const pasted = unpackPaste(data);
		if (pasted !== null) {
			const clean = this.#multiline ? pasted : pasted.replace(/\n/g, " ");
			this.#insert(clean);
			return;
		}
		const key = decodeKey(data, KEY_CTX);
		if (!key || key.kind === "release") return;

		switch (key.id) {
			case "escape":
				this.#onEscape?.();
				return;
			case "enter": {
				const value = this.#text;
				if (this.#multiline) {
					this.#text = "";
					this.#cursor = 0;
				}
				this.#onSubmit?.(value);
				return;
			}
			case "shift+enter":
			case "alt+enter":
			case "ctrl+enter":
			case "ctrl+j":
				if (this.#multiline) this.#insert("\n");
				return;
			case "backspace":
				if (this.#cursor > 0) {
					const from = prevGrapheme(this.#text, this.#cursor);
					this.#text = this.#text.slice(0, from) + this.#text.slice(this.#cursor);
					this.#cursor = from;
				}
				return;
			case "delete":
			case "ctrl+d":
				if (this.#cursor < this.#text.length) {
					const to = nextGrapheme(this.#text, this.#cursor);
					this.#text = this.#text.slice(0, this.#cursor) + this.#text.slice(to);
				}
				return;
			case "ctrl+w":
			case "alt+backspace": {
				const from = prevWord(this.#text, this.#cursor);
				this.#text = this.#text.slice(0, from) + this.#text.slice(this.#cursor);
				this.#cursor = from;
				return;
			}
			case "ctrl+u": {
				const start = lineStart(this.#text, this.#cursor);
				this.#text = this.#text.slice(0, start) + this.#text.slice(this.#cursor);
				this.#cursor = start;
				return;
			}
			case "ctrl+k": {
				const end = lineEnd(this.#text, this.#cursor);
				const to = end === this.#cursor ? Math.min(this.#text.length, this.#cursor + 1) : end;
				this.#text = this.#text.slice(0, this.#cursor) + this.#text.slice(to);
				return;
			}
			case "left":
			case "ctrl+b":
				this.#cursor = prevGrapheme(this.#text, this.#cursor);
				return;
			case "right":
			case "ctrl+f":
				this.#cursor = nextGrapheme(this.#text, this.#cursor);
				return;
			case "alt+left":
			case "ctrl+left":
			case "alt+b":
				this.#cursor = prevWord(this.#text, this.#cursor);
				return;
			case "alt+right":
			case "ctrl+right":
			case "alt+f":
				this.#cursor = nextWord(this.#text, this.#cursor);
				return;
			case "home":
			case "ctrl+a":
				this.#cursor = lineStart(this.#text, this.#cursor);
				return;
			case "end":
			case "ctrl+e":
				this.#cursor = lineEnd(this.#text, this.#cursor);
				return;
			case "up":
				if (this.#multiline) this.#moveVertical(-1);
				return;
			case "down":
				if (this.#multiline) this.#moveVertical(1);
				return;
		}

		if (key.text !== undefined) this.#insert(key.text);
	}

	render(width: number, theme: ExtensionTheme): string[] {
		if (width <= 0) return [""];
		if (!this.#multiline) return [this.#renderSingleLine(width, theme)];
		return this.#renderMultiline(width, theme);
	}

	#insert(str: string): void {
		this.#text = this.#text.slice(0, this.#cursor) + str + this.#text.slice(this.#cursor);
		this.#cursor += str.length;
	}

	#moveVertical(dir: -1 | 1): void {
		const start = lineStart(this.#text, this.#cursor);
		const col = this.#cursor - start;
		if (dir < 0) {
			if (start === 0) {
				this.#cursor = 0;
				return;
			}
			const prevEnd = start - 1;
			const prevStart = lineStart(this.#text, prevEnd);
			this.#cursor = Math.min(prevEnd, prevStart + col);
		} else {
			const end = lineEnd(this.#text, this.#cursor);
			if (end >= this.#text.length) {
				this.#cursor = this.#text.length;
				return;
			}
			const nextStart = end + 1;
			const nextEnd = lineEnd(this.#text, nextStart);
			this.#cursor = Math.min(nextEnd, nextStart + col);
		}
	}

	#renderSingleLine(width: number, theme: ExtensionTheme): string {
		if (!this.#text) {
			const caret = this.focused ? theme.inverse(" ") : "";
			const hint = this.#placeholder ? theme.fg("dim", this.#placeholder) : "";
			return truncate(`${caret}${hint}`, width, "");
		}
		const before = replaceTabs(this.#text.slice(0, this.#cursor));
		const at = this.#cursor < this.#text.length ? this.#text.slice(this.#cursor, nextGrapheme(this.#text, this.#cursor)) : "";
		const after = replaceTabs(this.#text.slice(this.#cursor + at.length));
		const caret = this.focused ? theme.inverse(at ? replaceTabs(at) : " ") : replaceTabs(at);
		const full = `${before}${caret}${after}`;
		if (visibleWidth(full) <= width) return full;
		// Keep the caret visible by trimming from the left when the query exceeds width.
		const caretCol = visibleWidth(before);
		const room = Math.max(1, width - 1);
		if (caretCol < room) return truncate(full, width, "");
		const plain = replaceTabs(this.#text);
		const tail = plain.slice(Math.max(0, plain.length - room));
		return truncate(this.focused ? `${tail}${theme.inverse(" ")}` : tail, width, "");
	}

	#renderMultiline(width: number, theme: ExtensionTheme): string[] {
		const border = theme.fg(this.focused ? "accent" : "borderMuted", "─".repeat(width));
		const inner = Math.max(1, width - 2);
		const bodyLines: string[] = [];
		if (!this.#text) {
			const caret = this.focused ? theme.inverse(" ") : "";
			const ph = this.#placeholder ? theme.fg("dim", this.#placeholder) : "";
			bodyLines.push(` ${truncate(`${caret}${ph}`, inner, "")}`);
		} else {
			const before = this.#text.slice(0, this.#cursor);
			const at = this.#cursor < this.#text.length ? this.#text.slice(this.#cursor, nextGrapheme(this.#text, this.#cursor)) : "";
			const after = this.#text.slice(this.#cursor + at.length);
			const caretChar = at === "\n" || at === "" ? " " : replaceTabs(at);
			const marker = this.focused ? theme.inverse(caretChar) : at === "\n" ? "" : replaceTabs(at);
			const combined = at === "\n" ? `${before}${marker}\n${after}` : `${before}${marker}${after}`;
			for (const logical of combined.split("\n")) {
				const wrapped = wrap(replaceTabs(logical), inner);
				for (const row of wrapped.length ? wrapped : [""]) bodyLines.push(` ${truncate(row, inner, "")}`);
			}
		}
		const maxBody = Math.max(1, this.#maxHeight - 2);
		const shown = bodyLines.length > maxBody ? bodyLines.slice(-maxBody) : bodyLines;
		return [border, ...shown, border];
	}
}
