import { createHash } from "node:crypto";

export type BlockKind = "heading" | "paragraph" | "list" | "table" | "code" | "quote" | "hr";

export interface Block {
	index: number;
	kind: BlockKind;
	source: string;
	/** Heading level for `heading` blocks, otherwise 0. */
	level: number;
	/** Heading trail this block sits under, outermost first. */
	headings: string[];
	/** Whitespace-insensitive content hash, used for change markers and anchors. */
	hash: string;
}

export function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function hashText(text: string): string {
	return createHash("sha1").update(normalizeText(text)).digest("hex").slice(0, 16);
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/;
/** List item at any nesting depth; LIST_ITEM only recognises a top-level item. */
const ANY_LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const NESTED_FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>/;
const INDENTED = /^\s{2,}\S/;

function isTableStart(lines: string[], i: number): boolean {
	return lines[i].trimStart().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]);
}

function startsOtherBlock(lines: string[], i: number): boolean {
	const line = lines[i];
	return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || HR.test(line) || isTableStart(lines, i);
}

/**
 * Split markdown into top-level blocks. Each block renders on its own, so the
 * reader can map every rendered row back to the source it came from.
 */
export function splitBlocks(markdown: string): Block[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	const trail: string[] = [];

	const push = (kind: BlockKind, start: number, end: number, level = 0): void => {
		const source = lines.slice(start, end).join("\n").replace(/\s+$/, "");
		if (!source.trim()) return;
		blocks.push({
			index: blocks.length,
			kind,
			source,
			level,
			headings: trail.filter(Boolean),
			hash: hashText(`${kind}:${source}`),
		});
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			const close = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
			let j = i + 1;
			while (j < lines.length && !close.test(lines[j])) j++;
			const end = Math.min(j + 1, lines.length);
			push("code", i, end);
			i = end;
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			const level = heading[1].length;
			trail.length = level - 1;
			trail[level - 1] = heading[2].replace(/[*_`]/g, "");
			push("heading", i, i + 1, level);
			i++;
			continue;
		}

		if (HR.test(line)) {
			push("hr", i, i + 1);
			i++;
			continue;
		}

		if (isTableStart(lines, i)) {
			let j = i + 2;
			while (j < lines.length && lines[j].trimStart().startsWith("|")) j++;
			push("table", i, j);
			i = j;
			continue;
		}

		if (QUOTE.test(line)) {
			let j = i;
			while (j < lines.length && QUOTE.test(lines[j])) j++;
			push("quote", i, j);
			i = j;
			continue;
		}

		if (LIST_ITEM.test(line)) {
			let j = i + 1;
			while (j < lines.length) {
				const next = lines[j];
				// A fence inside an item may contain blank lines; consume through its close.
				const nested = INDENTED.test(next) ? NESTED_FENCE.exec(next) : null;
				if (nested) {
					const close = new RegExp(`^\\s*${nested[1][0] === "`" ? "`" : "~"}{${nested[1].length},}\\s*$`);
					let k = j + 1;
					while (k < lines.length && !close.test(lines[k])) k++;
					j = Math.min(k + 1, lines.length);
					continue;
				}
				if (!next.trim()) {
					let k = j + 1;
					while (k < lines.length && !lines[k].trim()) k++;
					if (k < lines.length && (LIST_ITEM.test(lines[k]) || INDENTED.test(lines[k]))) {
						j = k;
						continue;
					}
					break;
				}
				if (LIST_ITEM.test(next) || INDENTED.test(next) || !startsOtherBlock(lines, j)) {
					j++;
					continue;
				}
				break;
			}
			push("list", i, j);
			i = j;
			continue;
		}

		let j = i + 1;
		while (j < lines.length && lines[j].trim() && !LIST_ITEM.test(lines[j]) && !startsOtherBlock(lines, j)) j++;
		push("paragraph", i, j);
		i = j;
	}
	return blocks;
}

const HARD_BREAK = /( {2,}|\\)$/;

/**
 * Markdown source with soft line breaks joined, for display only. omp's
 * renderer keeps every newline, so a hard-wrapped file would show ragged
 * half-lines; CommonMark treats a lone newline inside a paragraph as a space.
 * Hard breaks (two trailing spaces or a backslash), code and tables are kept.
 */
export function displaySource(block: Block): string {
	if (block.kind !== "paragraph" && block.kind !== "list" && block.kind !== "quote") return block.source;
	const out: string[] = [];
	let inFence = false;
	for (const line of block.source.split("\n")) {
		const prev = out.length ? out[out.length - 1] : undefined;
		const isFence = NESTED_FENCE.test(line.replace(/^\s*>\s?/, ""));
		// Decided before toggling, so neither the opening nor the closing fence line is ever joined.
		const joinable =
			!inFence &&
			!isFence &&
			prev !== undefined &&
			prev.trim() !== "" &&
			line.trim() !== "" &&
			!HARD_BREAK.test(prev) &&
			!NESTED_FENCE.test(prev.replace(/^\s*>\s?/, "")) &&
			(block.kind === "paragraph" ||
				(block.kind === "list" && !ANY_LIST_ITEM.test(line) && !line.trimStart().startsWith("|")) ||
				(block.kind === "quote" && QUOTE.test(line) && line.replace(/^\s*>\s?/, "").trim() !== "" && prev.replace(/^\s*>\s?/, "").trim() !== ""));
		if (isFence) inFence = !inFence;
		if (!joinable) {
			out.push(line);
			continue;
		}
		const text = block.kind === "quote" ? line.replace(/^\s*>\s?/, "") : line.trim();
		out[out.length - 1] = `${prev.trimEnd()} ${text.trim()}`;
	}
	return out.join("\n");
}
