import type { Message } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { type Block, normalizeText, splitBlocks } from "./blocks";
import type { Anchor, DocMeta, Thread, Turn } from "./store";

export interface Preset {
	key: string;
	label: string;
	question: string;
}

export const PRESETS: readonly Preset[] = [
	{ key: "1", label: "simpler", question: "Explain this passage more simply. Keep every technical detail that matters, and say what each term means." },
	{ key: "2", label: "why", question: "Why is this true? Walk through the reasoning or evidence behind it." },
	{ key: "3", label: "example", question: "Give a small, concrete example that shows this in action." },
	{ key: "4", label: "define", question: "Define the key terms in this passage, as they are used here." },
	{ key: "5", label: "connect", question: "How does this connect to what we are working on in this conversation?" },
	{
		key: "6",
		label: "intuitive",
		question:
			"I need you to explain it to me in a much more easy to understand and read way. You need to make it way more intuitive while still maintaining complete integrity and not lose out on any technical details at all.",
	},
];

/** The quick ask a question came from, or undefined for a question the user typed. */
export function presetFor(question: string): Preset | undefined {
	return PRESETS.find(preset => preset.question === question);
}

/** Above this size the prompt carries the outline plus the passage's neighbourhood, not the whole document. */
const FULL_DOC_CHARS = 60_000;
const NEIGHBOUR_BLOCKS = 12;

function documentContext(text: string, anchor: Anchor): { body: string; partial: boolean } {
	if (text.length <= FULL_DOC_CHARS) return { body: text, partial: false };
	const blocks = splitBlocks(text);
	const start = Math.max(0, anchor.startIndex - NEIGHBOUR_BLOCKS);
	const end = Math.min(blocks.length, anchor.endIndex + NEIGHBOUR_BLOCKS + 1);
	const contents = blocks
		.filter(block => block.kind === "heading")
		.map(block => `${"  ".repeat(block.level - 1)}- ${block.headings.at(-1) ?? ""}`)
		.join("\n");
	const excerpt = blocks
		.slice(start, end)
		.map(block => block.source)
		.join("\n\n");
	return { body: `Contents:\n${contents}\n\n[…]\n\n${excerpt}\n\n[…]`, partial: true };
}

/**
 * The first turn of a thread. Rebuilt from the stored version on every
 * follow-up, so the replayed history is byte-stable for prompt caching.
 */
export function firstPrompt(meta: DocMeta, docText: string, anchor: Anchor, question: string): string {
	const { body, partial } = documentContext(docText, anchor);
	const where = meta.external ? meta.file : `local://explain/${meta.slug}.md`;
	return [
		"<sidelight>",
		"Side question from Sidelight, the document reader. The user is reading the document below and selected a passage.",
		"Answer about the selected passage, using the document and this conversation.",
		"Be concrete and exact. Prefer short paragraphs, small lists or a small table. Stay under about 250 words unless the question needs more.",
		"If the passage is wrong or misleading, say so plainly and give the correction.",
		"NEVER use tools. NEVER ask follow-up questions.",
		"",
		`Document: ${meta.title} (${where}, version ${anchor.version}${partial ? ", excerpt" : ""})`,
		"<document>",
		body,
		"</document>",
		"",
		`Selected passage${anchor.heading ? ` (section: ${anchor.heading})` : ""}:`,
		"<passage>",
		anchor.quote,
		"</passage>",
		"",
		`Question: ${question}`,
		"</sidelight>",
	].join("\n");
}

export function followUpPrompt(question: string, revisedPassage?: string): string {
	const revision = revisedPassage
		? ["The document was revised since the last answer. The passage now reads:", "<passage>", revisedPassage, "</passage>", ""]
		: [];
	return ["<sidelight-followup>", ...revision, `Question: ${question}`, "</sidelight-followup>"].join("\n");
}

/** The passage's current text, or undefined when it no longer exists in the document. */
export function currentPassage(blocks: readonly Block[], anchor: Anchor): string | undefined {
	const start = blocks.findIndex(block => block.hash === anchor.startHash);
	const end = blocks.findIndex(block => block.hash === anchor.endHash);
	if (start >= 0 && end >= start) return blocks.slice(start, end + 1).map(block => block.source).join("\n\n");
	const needle = normalizeText(anchor.quote).slice(0, 80);
	const hit = blocks.find(block => normalizeText(block.source).includes(needle));
	return hit?.source;
}

export interface AskRequest {
	ctx: ExtensionContext;
	meta: DocMeta;
	thread: Thread;
	turn: Turn;
	/** Source text of every version a prior turn was asked against. */
	versionText: (n: number) => string;
	signal: AbortSignal;
	onDelta: (delta: string) => void;
	/** Columns the answer is shown in. Only the current turn mentions it, so replayed history stays cacheable. */
	width: number;
}

/** Run one turn through the same side-turn pipeline `/btw` uses. */
export async function runAsk(req: AskRequest): Promise<string> {
	const { ctx, meta, thread, turn } = req;
	if (!ctx.runEphemeralTurn) throw new Error("This omp host cannot run side turns.");
	const model = ctx.model;
	if (!model) throw new Error("No active model.");

	const prior = thread.turns.slice(0, thread.turns.indexOf(turn));
	const promptFor = (t: Turn, index: number): string => {
		if (index === 0) return firstPrompt(meta, req.versionText(thread.anchor.version), thread.anchor, t.q);
		const previous = thread.turns[index - 1];
		if (previous && previous.version !== t.version) {
			return followUpPrompt(t.q, currentPassage(splitBlocks(req.versionText(t.version)), thread.anchor));
		}
		return followUpPrompt(t.q);
	};

	const history: Message[] = prior.flatMap((t, index): Message[] => {
		const user: Message = {
			role: "user",
			content: [{ type: "text", text: promptFor(t, index) }],
			attribution: "agent",
			timestamp: t.at,
		};
		if (!t.a) return [user];
		const assistant: Message = {
			role: "assistant",
			content: [{ type: "text", text: t.a }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: t.doneAt ?? t.at,
		};
		return [user, assistant];
	});

	const result = await ctx.runEphemeralTurn({
		promptText: `${promptFor(turn, prior.length)}\n\nThe answer is shown in a terminal pane ${req.width} columns wide. Keep every diagram, table and code line within ${req.width} columns: prefer top-down mermaid (graph TD), at most 3 sequence participants, short labels, and narrow tables.`,
		history,
		conversationKey: thread.key,
		// The default 4 KiB cap is meant for one-liners; these answers are read in full.
		replyMaxBytes: Number.POSITIVE_INFINITY,
		onTextDelta: req.onDelta,
		signal: req.signal,
	});
	return result.replyText;
}
