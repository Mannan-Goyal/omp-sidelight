import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-utils";

/** Something the user did in the reader; tour steps advance on these. */
export type TourEvent =
	| "block"
	| "section"
	| "select"
	| "ask"
	| "answer"
	| "followup"
	| "browse"
	| "list"
	| "outline"
	| "search"
	| "zoom"
	| "help"
	| "close";

export interface TourStep {
	on: TourEvent;
	text: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
	{ on: "block", text: "Press ] to move to the next block (a paragraph, list, table or code block). [ goes back." },
	{ on: "section", text: "Press } to jump to the next section heading. { goes back." },
	{ on: "select", text: "Select a few lines: press v, then j two or three times. Dragging with the mouse works too." },
	{ on: "ask", text: "Press 6 to ask the 'intuitive' quick ask about your selection. 1-6 are all quick asks; a lets you type your own." },
	{ on: "answer", text: "The answer streams into a side thread on the right. It never enters your main chat. Wait for it to finish…" },
	{ on: "followup", text: "Type a follow-up in the box at the bottom right and press Enter. Shift+Enter adds a new line." },
	{ on: "browse", text: "Press Esc to step out of the box. Now y copies the answer, p pastes the thread into your chat, r resolves it." },
	{ on: "list", text: "Press Esc again for the thread list, grouped into answering, new answers, open, resolved and passage changed." },
	{ on: "outline", text: "Press Tab to go back to the document, then o for the outline. Enter on a heading jumps there." },
	{ on: "search", text: "Press Tab to return to the document, then / to search. Type a word and press Enter; n and N step through matches." },
	{ on: "zoom", text: "Press z to show only the focused pane at full width, for wide tables and diagrams. z again restores the split." },
	{ on: "help", text: "Press ? to see every key. Press ? again to close it." },
	{ on: "close", text: "That's everything. Press q to close the reader. Replay this tour any time with /read tour." },
];

/** The sample document the tour runs on. Written to give the quick asks something real to answer. */
export const TOUR_DOC = `# Welcome to Sidelight

This is a short sample document for the tour. Anything the agent publishes with the \`explain\` tool opens here, the same way.

## Why a separate reader

Long answers printed into the chat scroll away, and every revision reprints all of it. Here the agent writes a document once and edits it in place. When it changes, the reader marks the blocks that changed since you last read, and \`d\` jumps between them.

Asking about one sentence in the chat costs a whole new turn, and the question and answer stay in the agent's context for good. A side thread here knows the whole conversation, but nothing you ask is added to it.

## How a side thread works

| Step | What happens |
|---|---|
| You select a passage | The reader records its text and the blocks around it |
| You ask | One side turn goes to the model, with the conversation, the document and the passage |
| The answer streams | It is saved next to the document, never in the session journal |
| The document changes later | The thread follows its passage; if the passage was rewritten, the thread moves to "passage changed" |

## Where things are kept

Documents, their versions and your threads live in the session's own folder. Closing omp keeps them; \`/read\` brings them back.

## Keys worth remembering

- \`[\` \`]\` move by block, \`{\` \`}\` by section
- \`v\` selects, \`a\` asks, \`1\`-\`6\` are quick asks
- \`?\` shows every key
`;

interface TourState {
	/** The first-run card was shown once; never offer again. */
	offered: boolean;
	completed: boolean;
}

function stateFile(): string {
	// Internal folder name, kept from before the rename so existing installs keep their state.
	return path.join(getAgentDir(), "explain-reader", "tour.json");
}

export function loadTourState(): TourState {
	try {
		return { offered: false, completed: false, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) };
	} catch {
		return { offered: false, completed: false };
	}
}

export function saveTourState(patch: Partial<TourState>): void {
	const file = stateFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ ...loadTourState(), ...patch }, null, 2));
}

/** Progress through {@link TOUR_STEPS} for one reader. */
export class Tour {
	step = 0;
	/** When the last step was completed, to show a brief tick. */
	doneAt = 0;

	get current(): TourStep | undefined {
		return TOUR_STEPS[this.step];
	}

	get finished(): boolean {
		return this.step >= TOUR_STEPS.length;
	}

	/** Advance when `event` is what the current step waits for. Returns true when it advanced. */
	hit(event: TourEvent): boolean {
		if (this.current?.on !== event) return false;
		this.step++;
		this.doneAt = Date.now();
		if (this.finished) saveTourState({ completed: true });
		return true;
	}
}
