/** A link on a rendered row: visible columns `start` (inclusive) to `end` (exclusive). */
export interface LinkSpan {
	start: number;
	end: number;
	href: string;
}

/** Terminal columns a grapheme takes; the reader passes pi-tui's `visibleWidth`. */
export type Width = (grapheme: string) => number;

const segmenter = new Intl.Segmenter();
/** A URL written out in the visible text, as GFM autolinks it. */
const PLAIN_URL = /(?<![A-Za-z0-9+.-])(?:https?:\/\/|mailto:)[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const OPENERS: Partial<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

/** `url` without trailing punctuation or a closing bracket it never opened, like `(https://x.dev)`. */
function trimUrl(url: string): string {
	let out = url;
	for (;;) {
		const before = out;
		out = out.replace(TRAILING_PUNCTUATION, "");
		const closer = out.at(-1) ?? "";
		const opener = OPENERS[closer];
		if (opener !== undefined && out.split(closer).length > out.split(opener).length) out = out.slice(0, -1);
		if (out === before) return out;
	}
}

/**
 * Every link on a rendered row. pi-tui wraps each link in an OSC 8 hyperlink
 * (`ESC ] 8 ; ; url BEL`) when the terminal supports them, and reopens it on
 * each wrapped line, so those spans carry the full destination. URLs shown as
 * plain text (terminals without OSC 8, where a link renders as `text (url)`)
 * are found in the visible text.
 */
export function linkSpans(text: string, width: Width): LinkSpan[] {
	const spans: LinkSpan[] = [];
	let visible = "";
	/** Column of each UTF-16 offset in `visible`. */
	const columns: number[] = [];
	let col = 0;
	let href = "";
	const addVisible = (chunk: string): void => {
		for (const { segment } of segmenter.segment(chunk)) {
			const w = width(segment);
			if (href) {
				const last = spans.at(-1);
				if (last && last.href === href && last.end === col) last.end += w;
				else if (w > 0) spans.push({ start: col, end: col + w, href });
			}
			for (let i = 0; i < segment.length; i++) columns.push(col);
			visible += segment;
			col += w;
		}
	};
	let i = 0;
	while (i < text.length) {
		const esc = text.indexOf("\x1b", i);
		if (esc < 0) {
			addVisible(text.slice(i));
			break;
		}
		if (esc > i) addVisible(text.slice(i, esc));
		const kind = text[esc + 1];
		if (kind === "[") {
			let j = esc + 2;
			while (j < text.length && !/[@-~]/.test(text[j])) j++;
			i = j + 1;
		} else if (kind === "]" || kind === "_" || kind === "P") {
			const bel = text.indexOf("\x07", esc + 2);
			const st = text.indexOf("\x1b\\", esc + 2);
			const end = bel >= 0 && (st < 0 || bel < st) ? bel : st;
			const body = text.slice(esc + 2, end < 0 ? text.length : end);
			if (kind === "]" && body.startsWith("8;")) href = body.slice(body.indexOf(";", 2) + 1);
			i = end < 0 ? text.length : end + (end === bel ? 1 : 2);
		} else {
			i = esc + 2;
		}
	}
	columns.push(col);
	for (const match of visible.matchAll(PLAIN_URL)) {
		const url = trimUrl(match[0]);
		const start = columns[match.index];
		const end = columns[match.index + url.length];
		if (!/^(?:https?:\/\/|mailto:)./.test(url) || spans.some(span => span.start < end && start < span.end)) continue;
		spans.push({ start, end, href: url });
	}
	return spans.sort((a, b) => a.start - b.start);
}

/** The link at visible column `col` of a rendered row, if any. */
export function linkAt(text: string, col: number, width: Width): string | undefined {
	return linkSpans(text, width).find(span => col >= span.start && col < span.end)?.href;
}

/**
 * The "Open which link?" question's answer to `key`. Every digit answers it,
 * even one past the list, so a slip never reaches the document keys, where
 * 1-6 send a quick ask to the model.
 */
export function pickLink(links: readonly string[], key: string): { answered: boolean; href?: string } {
	if (!/^[1-9]$/.test(key)) return { answered: false };
	return { answered: true, href: links[Number(key) - 1] };
}

/** Only web and mail links are handed to the system; a `file:` or app URL could launch a program. */
export function isOpenable(href: string): boolean {
	return /^(?:https?:\/\/|mailto:)\S+$/i.test(href);
}

/** The system command that opens `url` in the default browser or mail app. No shell parses `url`. */
export function openerCommand(platform: string, url: string): { command: string; args: string[] } {
	if (platform === "darwin") return { command: "open", args: [url] };
	if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
	return { command: "xdg-open", args: [url] };
}
