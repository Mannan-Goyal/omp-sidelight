import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { splitBlocks } from "./blocks";

export type VersionSource = "publish" | "auto" | "open";

export interface VersionInfo {
	n: number;
	at: number;
	sha: string;
	source: VersionSource;
	note?: string;
}

export interface DocMeta {
	slug: string;
	title: string;
	/** Absolute path of the live document. */
	file: string;
	/** True when opened with `/read <path>` rather than written under local://explain/. */
	external: boolean;
	versions: VersionInfo[];
	/** Version the user last finished reading; drives the change markers. */
	lastRead?: number;
	updatedAt: number;
}

export interface Anchor {
	/** Exact text the user selected, as shown in the reader. */
	quote: string;
	startHash: string;
	endHash: string;
	startIndex: number;
	endIndex: number;
	/** Document version the passage was selected in. */
	version: number;
	heading: string;
}

export type TurnStatus = "running" | "complete" | "cancelled" | "error" | "interrupted";

export interface Turn {
	q: string;
	a: string;
	status: TurnStatus;
	at: number;
	doneAt?: number;
	/** Document version current when the question was asked. */
	version: number;
	error?: string;
}

export interface Thread {
	id: string;
	createdAt: number;
	updatedAt: number;
	resolved: boolean;
	anchor: Anchor;
	turns: Turn[];
	/** Provider lineage key for this thread's side turns; rotated after a cancelled or failed turn. */
	key: string;
	/** Finished turns the user has viewed; answers past it show as new. Absent on threads from before this field. */
	seen?: number;
}

export const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function atomicWrite(file: string, data: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function titleFrom(text: string, fallback: string): string {
	const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text);
	return heading ? heading[1].replace(/[*_`]/g, "").trim() : fallback;
}

export interface Snapshot {
	meta: DocMeta;
	version: VersionInfo;
	created: boolean;
	/** Blocks whose content is new or changed relative to the previous version. */
	changedBlocks: number;
	words: number;
	sections: number;
}

/**
 * Session-private storage for explain documents. Lives under the session's
 * artifacts directory, beside `/btw` history, and never writes the session
 * journal, so nothing here reaches the main conversation.
 */
export class Store {
	readonly localDir: string;
	readonly root: string;

	constructor(readonly artifactsDir: string) {
		this.localDir = path.join(artifactsDir, "local", "explain");
		this.root = path.join(artifactsDir, "explain-reader", "docs");
	}

	docDir(slug: string): string {
		return path.join(this.root, slug);
	}

	/** Slug for a session document named by slug, `local://explain/<slug>.md`, or its absolute path. */
	sessionSlug(ref: string): string | undefined {
		const trimmed = ref.trim();
		const local = /^local:\/\/explain\/(.+?)(?:\.md)?$/.exec(trimmed);
		if (local) return SLUG.test(local[1]) ? local[1] : undefined;
		if (path.isAbsolute(trimmed) && path.dirname(trimmed) === this.localDir) {
			const base = path.basename(trimmed, ".md");
			return SLUG.test(base) ? base : undefined;
		}
		const bare = trimmed.replace(/\.md$/, "");
		return SLUG.test(bare) ? bare : undefined;
	}

	loadMeta(slug: string): DocMeta | undefined {
		return readJson<DocMeta>(path.join(this.docDir(slug), "meta.json"));
	}

	saveMeta(meta: DocMeta): void {
		atomicWrite(path.join(this.docDir(meta.slug), "meta.json"), JSON.stringify(meta, null, 2));
	}

	/** Every known document: published ones plus session files not yet published. */
	listDocs(): DocMeta[] {
		const docs = new Map<string, DocMeta>();
		for (const name of safeReaddir(this.root)) {
			const meta = this.loadMeta(name);
			if (meta) docs.set(meta.slug, meta);
		}
		for (const name of safeReaddir(this.localDir)) {
			if (!name.endsWith(".md")) continue;
			const slug = name.slice(0, -3);
			if (!SLUG.test(slug) || docs.has(slug)) continue;
			const file = path.join(this.localDir, name);
			docs.set(slug, {
				slug,
				title: titleFrom(fs.readFileSync(file, "utf8"), slug),
				file,
				external: false,
				versions: [],
				updatedAt: fs.statSync(file).mtimeMs,
			});
		}
		return [...docs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** Register an arbitrary markdown file; its slug is derived from the absolute path. */
	externalMeta(absPath: string): DocMeta {
		const slug = `file-${createHash("sha1").update(absPath).digest("hex").slice(0, 12)}`;
		return (
			this.loadMeta(slug) ?? {
				slug,
				title: path.basename(absPath),
				file: absPath,
				external: true,
				versions: [],
				updatedAt: Date.now(),
			}
		);
	}

	readVersion(slug: string, n: number): string | undefined {
		try {
			return fs.readFileSync(path.join(this.docDir(slug), `v${n}.md`), "utf8");
		} catch {
			return undefined;
		}
	}

	/**
	 * Record the live file as a new version when its content changed. Returns
	 * the latest version either way, so callers can always render a version.
	 */
	snapshot(base: DocMeta, source: VersionSource, opts: { title?: string; note?: string } = {}): Snapshot {
		const text = fs.readFileSync(base.file, "utf8");
		const sha = createHash("sha1").update(text).digest("hex");
		const meta: DocMeta = { ...base, versions: [...base.versions] };
		if (opts.title?.trim()) meta.title = opts.title.trim();
		else if (meta.title === meta.slug || !meta.versions.length) meta.title = titleFrom(text, meta.title);

		const blocks = splitBlocks(text);
		const stats = {
			words: text.split(/\s+/).filter(Boolean).length,
			sections: blocks.filter(block => block.kind === "heading").length,
		};
		const latest = meta.versions.at(-1);
		if (latest && latest.sha === sha) {
			if (opts.note && source === "publish" && !latest.note) latest.note = opts.note;
			if (source === "publish" && latest.source !== "publish") latest.source = "publish";
			this.saveMeta(meta);
			return { meta, version: latest, created: false, changedBlocks: 0, ...stats };
		}

		let changedBlocks = blocks.length;
		if (latest) {
			const previous = new Set(splitBlocks(this.readVersion(meta.slug, latest.n) ?? "").map(block => block.hash));
			changedBlocks = blocks.filter(block => !previous.has(block.hash)).length;
		}
		const version: VersionInfo = {
			n: (latest?.n ?? 0) + 1,
			at: Date.now(),
			sha,
			source,
			...(opts.note?.trim() ? { note: opts.note.trim() } : {}),
		};
		atomicWrite(path.join(this.docDir(meta.slug), `v${version.n}.md`), text);
		meta.versions.push(version);
		meta.updatedAt = version.at;
		this.saveMeta(meta);
		return { meta, version, created: true, changedBlocks, ...stats };
	}

	markRead(slug: string, version: number): void {
		const meta = this.loadMeta(slug);
		if (!meta || meta.lastRead === version) return;
		this.saveMeta({ ...meta, lastRead: version });
	}

	loadThreads(slug: string): Thread[] {
		const threads = readJson<Thread[]>(path.join(this.docDir(slug), "threads.json")) ?? [];
		// A turn still marked running after a restart lost its stream; never resubmit it.
		for (const thread of threads) {
			for (const turn of thread.turns) if (turn.status === "running") turn.status = "interrupted";
		}
		return threads;
	}

	saveThreads(slug: string, threads: readonly Thread[]): void {
		atomicWrite(path.join(this.docDir(slug), "threads.json"), JSON.stringify(threads, null, 2));
	}

	/** Write a markdown body as a new session document and return its slug. */
	createSessionDoc(baseSlug: string, text: string): string {
		fs.mkdirSync(this.localDir, { recursive: true });
		let slug = baseSlug;
		for (let n = 2; fs.existsSync(path.join(this.localDir, `${slug}.md`)); n++) slug = `${baseSlug}-${n}`;
		atomicWrite(path.join(this.localDir, `${slug}.md`), text);
		return slug;
	}
}

function safeReaddir(dir: string): string[] {
	try {
		return fs.readdirSync(dir);
	} catch {
		return [];
	}
}
