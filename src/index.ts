import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Text } from "@oh-my-pi/pi-tui";
import { Reader } from "./reader";
import { type OpenDoc, Runtime } from "./runtime";
import { type DocMeta, SLUG } from "./store";
import { loadTourState, saveTourState, TOUR_DOC, Tour } from "./tour";

const SHORTCUT = "ctrl+n";

const TOOL_DESCRIPTION = `Publish a long-form explanation for the user to read in Sidelight, the document reader (/read, or ${SHORTCUT}).
The reader shows rendered markdown full-screen; the user selects passages and asks about them in side threads that never enter this conversation.

Use it when a reply would be long (more than ~500 words, several sections, tables or diagrams), or when the user asks for an in-depth explanation, research write-up, design or walkthrough:
1. Write the document as markdown to local://explain/<slug>.md with the write tool (slug: short kebab-case, e.g. engine-api-rewind).
2. Call this tool with the slug, a title, and for revisions a one-line note of what changed.
3. In chat, reply with 2-5 lines: what the document covers or what changed, and that it is open in /read. Do not paste the document into chat.

To revise, edit the same file surgically with the edit tool and call this tool again with a note. Never rewrite or reprint the whole document for a small change; the reader marks what changed since the user last read it.

The document is shown in a pane about 90 columns wide (wider content is cut off until the user zooms). Keep diagrams within that: prefer top-down mermaid (graph TD), sequence diagrams with at most 4 participants, short node and edge labels, and narrow tables. Put a diagram next to the prose that walks through it, and define every term the first time it appears.`;

interface ExplainDetails {
	slug: string;
	title: string;
	version: number;
	created: boolean;
	changedBlocks: number;
	words: number;
	sections: number;
	note?: string;
}

/** Slugs of explain documents a write/edit tool call touched, from its raw input. */
function touchedSlugs(input: unknown, localDir: string): string[] {
	const text = JSON.stringify(input ?? "");
	const found = new Set<string>();
	const patterns = [/local:\/\/explain\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md/g, new RegExp(`${localDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Za-z0-9][A-Za-z0-9._-]*)\\.md`, "g")];
	for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]);
	return [...found];
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const parts: string[] = [];
		for (const block of entry.message.content) if (block.type === "text") parts.push(block.text);
		const text = parts.join("\n\n").trim();
		if (text) return text;
	}
	return undefined;
}

/** A document `/read` can open, as its completion menu and the ctrl+n picker show it. */
interface ReadEntry {
	meta: DocMeta;
	/** What `/read <value>` resolves: the slug, or the path for an outside file. */
	value: string;
	label: string;
	description: string;
}

function ago(at: number): string {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Where this session keeps the tour's sample document. */
function tourFile(rt: Runtime): string {
	return path.join(rt.store.artifactsDir, "explain-reader", "tour.md");
}

/**
 * What `/read` offers, in this order:
 * 1. explanations the agent wrote under local://explain/ (published or auto-saved), newest first;
 * 2. replies saved with `/read last`;
 * 3. outside files opened before with `/read <path>`, so their threads are one step away.
 * A document whose file is gone or empty is left out, and so is the tour (`/read tour` opens it).
 */
function catalog(rt: Runtime): ReadEntry[] {
	const tour = tourFile(rt);
	const live = rt.store.listDocs().filter(doc => {
		if (doc.file === tour) return false;
		try {
			return fs.statSync(doc.file).size > 0;
		} catch {
			return false;
		}
	});
	const describe = (doc: DocMeta): string => {
		const latest = doc.versions.at(-1);
		return [latest ? `v${latest.n}` : "not yet published", ago(doc.updatedAt), ...(latest?.note ? [latest.note] : [])].join(" · ");
	};
	const isReply = (doc: DocMeta): boolean => doc.slug.startsWith("reply-");
	return [
		...live.filter(doc => !doc.external && !isReply(doc)).map(doc => ({ meta: doc, value: doc.slug, label: doc.title, description: describe(doc) })),
		...live.filter(doc => !doc.external && isReply(doc)).map(doc => ({ meta: doc, value: doc.slug, label: doc.title, description: `saved reply · ${ago(doc.updatedAt)}` })),
		...live.filter(doc => doc.external).map(doc => ({ meta: doc, value: doc.file, label: doc.title, description: `file · ${doc.file}` })),
	];
}

export default function explain(pi: ExtensionAPI): void {
	const type = pi.arktype;
	pi.setLabel("Sidelight");
	let runtime: Runtime | undefined;

	/** The runtime for the session `ctx` belongs to; rebuilt when the session (and its artifacts) change. */
	const runtimeFor = (ctx: ExtensionContext): Runtime => {
		const sessionId = ctx.sessionManager.getSessionId();
		const dir = ctx.sessionManager.getArtifactsDir() ?? path.join(os.tmpdir(), "omp-explain", sessionId);
		if (!runtime || runtime.store.artifactsDir !== dir) {
			runtime?.abortAll();
			runtime = new Runtime(dir, ctx);
		}
		runtime.ctx = ctx;
		return runtime;
	};

	/** The tour's sample document, written into this session's folder so its threads live with the session. */
	const tourMeta = (rt: Runtime): DocMeta => {
		const file = tourFile(rt);
		if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== TOUR_DOC) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, TOUR_DOC);
		}
		return { ...rt.store.externalMeta(file), title: "Sidelight tour" };
	};

	const openReader = async (ctx: ExtensionContext, meta: DocMeta, tour = false): Promise<void> => {
		if (!ctx.hasUI || ctx.mode !== "tui") {
			ctx.ui.notify("Sidelight needs the interactive terminal UI.", "warning");
			return;
		}
		const rt = runtimeFor(ctx);
		let doc: OpenDoc;
		try {
			doc = rt.open(meta);
		} catch (error) {
			ctx.ui.notify(`Sidelight: ${(error as Error).message}`, "error");
			return;
		}
		// The first time any document opens, the reader offers the tour once.
		const offerTour = !tour && !loadTourState().offered;
		if (offerTour) saveTourState({ offered: true });
		let startTour = false;
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new Reader(tui, theme, () => done(undefined), rt, doc, {
					tour: tour ? new Tour() : undefined,
					offerTour,
					onStartTour: () => {
						startTour = true;
					},
				}),
			{
				overlay: true,
				overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true },
			},
		);
		if (startTour) await openTour(ctx);
	};

	const openTour = async (ctx: ExtensionContext): Promise<void> => {
		await openReader(ctx, tourMeta(runtimeFor(ctx)), true);
	};

	const resolveTarget = async (ctx: ExtensionContext, arg: string): Promise<DocMeta | undefined> => {
		const rt = runtimeFor(ctx);
		const ref = arg.trim();
		if (ref === "last") {
			const text = lastAssistantText(ctx);
			if (!text) {
				ctx.ui.notify("No assistant reply to read yet.", "warning");
				return undefined;
			}
			const slug = rt.store.createSessionDoc(`reply-${new Date().toISOString().slice(0, 10)}`, text);
			return { slug, title: slug, file: path.join(rt.store.localDir, `${slug}.md`), external: false, versions: [], updatedAt: Date.now() };
		}
		if (ref) {
			const slug = rt.store.sessionSlug(ref);
			const known = slug ? rt.store.listDocs().find(doc => doc.slug === slug) : undefined;
			if (known) return known;
			const abs = path.resolve(ctx.cwd, ref.replace(/^~(?=$|\/)/, os.homedir()));
			if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return rt.store.externalMeta(abs);
			ctx.ui.notify(`No explain document or file named “${ref}”.`, "warning");
			return undefined;
		}
		const entries = catalog(rt);
		if (!entries.length) {
			if (!loadTourState().completed) {
				ctx.ui.notify("No explain documents yet, so here is the guided tour. Replay it any time with /read tour.", "info");
				return tourMeta(rt);
			}
			ctx.ui.notify("No explain documents yet. Try /read last for the latest reply, /read <file.md>, or /read tour.", "info");
			return undefined;
		}
		if (entries.length === 1) return entries[0].meta;
		const labels = entries.map(entry => `${entry.label} [${entry.meta.external ? path.basename(entry.value) : entry.value}]`);
		const picked = await ctx.ui.select(
			"Explain documents",
			entries.map((entry, i) => ({ label: labels[i], description: entry.description })),
		);
		return picked ? entries[labels.indexOf(picked)]?.meta : undefined;
	};

	const explainParams = type({
		doc: type("string").describe("Document slug, or local://explain/<slug>.md"),
		"title?": type("string").describe("Title shown in the reader"),
		"note?": type("string").describe("One line: what changed in this version"),
	});

	pi.registerTool<typeof explainParams, ExplainDetails>({
		name: "explain",
		label: "Explain",
		description: TOOL_DESCRIPTION,
		loadMode: "essential",
		// Writes only this session's private sidecar, like /btw history.
		approval: "read",
		parameters: explainParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = runtimeFor(ctx);
			const slug = rt.store.sessionSlug(params.doc);
			if (!slug || !SLUG.test(slug)) throw new Error(`Invalid document name “${params.doc}”. Use a kebab-case slug.`);
			const file = path.join(rt.store.localDir, `${slug}.md`);
			if (!fs.existsSync(file)) throw new Error(`Write the document first: local://explain/${slug}.md`);
			const base = rt.store.loadMeta(slug) ?? { slug, title: slug, file, external: false, versions: [], updatedAt: Date.now() };
			const snap = rt.publish(base, { title: params.title, note: params.note });
			const details: ExplainDetails = {
				slug,
				title: snap.meta.title,
				version: snap.version.n,
				created: snap.created,
				changedBlocks: snap.changedBlocks,
				words: snap.words,
				sections: snap.sections,
				...(snap.version.note ? { note: snap.version.note } : {}),
			};
			const change = snap.version.n > 1 ? `, ${snap.changedBlocks} block(s) changed` : "";
			return {
				content: [
					{
						type: "text",
						text: `Published “${details.title}” as v${details.version} (${details.words} words, ${details.sections} sections${change}). The user reads it with /read. Reply in chat with a 2-5 line summary only; do not paste the document.`,
					},
				],
				details,
			};
		},
		renderResult(result, _options, theme) {
			const details = result.details as ExplainDetails | undefined;
			if (!details) return new Text(theme.fg("muted", "explain"), 1, 0);
			const change = details.version > 1 ? ` · ${details.changedBlocks} changed` : "";
			const note = details.note ? theme.fg("muted", ` · ${details.note}`) : "";
			const line = `${theme.fg("accent", "📖 ")}${theme.bold(details.title)}${theme.fg("muted", ` · v${details.version} · ${details.words} words${change}`)}${note}${theme.fg("dim", ` · /read or ${SHORTCUT}`)}`;
			return new Text(line, 1, 0);
		},
	});

	pi.registerCommand("read", {
		description: "Read an explain document: select passages and ask about them in side threads",
		getArgumentCompletions: (prefix: string) => {
			if (!runtime) return null;
			const needle = prefix.trim().toLowerCase();
			const matches = (entry: { value: string; label: string }): boolean =>
				!needle || entry.value.toLowerCase().startsWith(needle) || entry.label.toLowerCase().includes(needle);
			const items = catalog(runtime)
				.filter(matches)
				.map(entry => ({ value: entry.value, label: entry.label, description: entry.description }));
			// `last` only when there is a reply to turn into a document.
			const last = { value: "last", label: "last", description: "open the latest assistant reply as a document" };
			if (lastAssistantText(runtime.ctx) && matches(last)) items.push(last);
			const tour = { value: "tour", label: "tour", description: "2-minute guided walkthrough of every feature" };
			if (matches(tour)) items.push(tour);
			return items;
		},
		handler: async (args, ctx) => {
			if (args.trim() === "tour") {
				await openTour(ctx);
				return;
			}
			const meta = await resolveTarget(ctx, args);
			if (!meta) return;
			await openReader(ctx, meta, meta.file === tourFile(runtimeFor(ctx)));
		},
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Open Sidelight, the document reader",
		handler: async ctx => {
			const meta = await resolveTarget(ctx, "");
			if (meta) await openReader(ctx, meta, meta.file === tourFile(runtimeFor(ctx)));
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		runtimeFor(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return;
		const rt = runtimeFor(ctx);
		for (const slug of touchedSlugs(event.input, rt.store.localDir)) rt.dirty.add(slug);
	});

	// Docs the agent edited without publishing still get a version, so the reader can mark the change.
	pi.on("agent_end", async (_event, ctx) => {
		const rt = runtimeFor(ctx);
		for (const slug of rt.dirty) {
			const file = path.join(rt.store.localDir, `${slug}.md`);
			if (!fs.existsSync(file)) continue;
			const base = rt.store.loadMeta(slug) ?? { slug, title: slug, file, external: false, versions: [], updatedAt: Date.now() };
			rt.store.snapshot(base, "auto", { note: "edited by the agent" });
		}
		rt.dirty.clear();
	});

	pi.on("session_shutdown", async () => {
		runtime?.abortAll();
	});
}
