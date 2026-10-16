import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { runAsk } from "./ask";
import type { Anchor, DocMeta, Snapshot, Thread, Turn, VersionSource } from "./store";
import { Store } from "./store";

export interface OpenDoc {
	meta: DocMeta;
	version: number;
	text: string;
}

/**
 * Per-session state: the store, every loaded thread, and in-flight side
 * turns. Lives outside the reader so an answer keeps streaming (and is saved)
 * after the reader closes.
 */
export class Runtime {
	readonly store: Store;
	ctx: ExtensionContext;
	/** True while a reader overlay is open; completed answers notify only when it is not. */
	readerOpen = false;
	readonly #threads = new Map<string, Thread[]>();
	readonly #running = new Map<string, AbortController>();
	readonly #listeners = new Set<() => void>();
	/** Session documents edited by the agent since its last turn ended. */
	readonly dirty = new Set<string>();

	constructor(artifactsDir: string, ctx: ExtensionContext) {
		this.store = new Store(artifactsDir);
		this.ctx = ctx;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emit(): void {
		for (const listener of this.#listeners) {
			try {
				listener();
			} catch {
				// A broken listener must not stop an answer from being saved.
			}
		}
	}

	/** Snapshot the live file (recording a version if it changed) and return the version to show. */
	open(base: DocMeta, source: VersionSource = "open"): OpenDoc {
		let snap: Snapshot | undefined;
		if (fs.existsSync(base.file)) snap = this.store.snapshot(base, source);
		const meta = snap?.meta ?? base;
		const latest = meta.versions.at(-1);
		if (!latest) throw new Error(`${base.file} does not exist`);
		return { meta, version: latest.n, text: this.store.readVersion(meta.slug, latest.n) ?? "" };
	}

	publish(base: DocMeta, opts: { title?: string; note?: string }): Snapshot {
		this.dirty.delete(base.slug);
		return this.store.snapshot(base, "publish", opts);
	}

	versionText(meta: DocMeta, n: number): string {
		return this.store.readVersion(meta.slug, n) ?? fs.readFileSync(meta.file, "utf8");
	}

	threads(slug: string): Thread[] {
		let threads = this.#threads.get(slug);
		if (!threads) {
			threads = this.store.loadThreads(slug);
			this.#threads.set(slug, threads);
		}
		return threads;
	}

	#save(slug: string): void {
		try {
			this.store.saveThreads(slug, this.threads(slug));
		} catch (error) {
			this.ctx.ui.notify(`Sidelight: could not save threads: ${(error as Error).message}`, "error");
		}
	}

	isRunning(threadId: string): boolean {
		return this.#running.has(threadId);
	}

	createThread(slug: string, anchor: Anchor): Thread {
		const now = Date.now();
		const thread: Thread = { id: randomUUID(), createdAt: now, updatedAt: now, resolved: false, anchor, turns: [], key: randomUUID(), seen: 0 };
		this.threads(slug).push(thread);
		return thread;
	}

	/** Start a side turn. Returns false when this thread already has one running. */
	ask(meta: DocMeta, thread: Thread, question: string, version: number, width: number): boolean {
		if (this.#running.has(thread.id)) return false;
		const turn: Turn = { q: question, a: "", status: "running", at: Date.now(), version };
		thread.turns.push(turn);
		thread.updatedAt = turn.at;
		thread.resolved = false;
		this.#save(meta.slug);
		this.#emit();

		const controller = new AbortController();
		this.#running.set(thread.id, controller);
		const settle = (patch: Partial<Turn>): void => {
			Object.assign(turn, patch, { doneAt: Date.now() });
			this.#running.delete(thread.id);
			this.#save(meta.slug);
			this.#emit();
		};

		runAsk({
			ctx: this.ctx,
			meta,
			thread,
			turn,
			versionText: n => this.versionText(meta, n),
			signal: controller.signal,
			width,
			onDelta: delta => {
				turn.a += delta;
				this.#emit();
			},
		})
			.then(reply => {
				settle({ a: reply, status: "complete" });
				if (!this.readerOpen) this.ctx.ui.notify(`Sidelight: answer ready in “${meta.title}”. /read to open.`, "info");
			})
			.catch((error: unknown) => {
				// The next request must not share an unwinding request's provider state.
				thread.key = randomUUID();
				if (controller.signal.aborted) settle({ status: "cancelled" });
				else settle({ status: "error", error: error instanceof Error ? error.message : String(error) });
			})
			.catch(() => {
				// settle() already reports save failures; nothing may escape as an unhandled rejection.
			});
		return true;
	}

	cancel(threadId: string): boolean {
		const controller = this.#running.get(threadId);
		if (!controller) return false;
		controller.abort();
		return true;
	}

	setResolved(slug: string, thread: Thread, resolved: boolean): void {
		thread.resolved = resolved;
		thread.updatedAt = Date.now();
		this.#save(slug);
		this.#emit();
	}

	/** Answers the user has not looked at yet: finished turns past the last one seen. */
	unseen(thread: Thread): number {
		const finished = thread.turns.filter(turn => turn.status !== "running").length;
		return Math.max(0, finished - (thread.seen ?? finished));
	}

	/** Record that the user has seen every finished answer in the thread. */
	markSeen(slug: string, thread: Thread): void {
		const finished = thread.turns.filter(turn => turn.status !== "running").length;
		if (thread.seen === finished) return;
		thread.seen = finished;
		this.#save(slug);
	}

	deleteThread(slug: string, thread: Thread): void {
		this.cancel(thread.id);
		const threads = this.threads(slug);
		const index = threads.indexOf(thread);
		if (index >= 0) threads.splice(index, 1);
		this.#save(slug);
		this.#emit();
	}

	abortAll(): void {
		for (const controller of this.#running.values()) controller.abort();
	}
}
