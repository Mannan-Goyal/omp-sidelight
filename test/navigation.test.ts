import assert from "node:assert/strict";
import { test } from "node:test";
import { jumpOrigin, scrollMargin, type View, wheelView } from "../src/navigation.ts";

/** 60 blocks of 3 rows each with a blank row between them, like the reader's layout. */
function layout(blocks = 60, height = 3): { rows: Array<{ block: number }>; first: number[] } {
	const rows: Array<{ block: number }> = [];
	const first: number[] = [];
	for (let block = 0; block < blocks; block++) {
		if (rows.length) rows.push({ block: -1 });
		first[block] = rows.length;
		for (let i = 0; i < height; i++) rows.push({ block });
	}
	return { rows, first };
}

const BODY = 37;
const NOTCH = 3;

function wheel(view: View, notches: number, total: number, selecting = false): View {
	let next = view;
	for (let i = 0; i < Math.abs(notches); i++) next = wheelView(next, Math.sign(notches) * NOTCH, total, BODY, selecting);
	return next;
}

/** Where `]` puts the cursor: the first row of the block after the one it counts from. */
function nextBlockRow(rows: Array<{ block: number }>, first: number[], cursor: number): number {
	return first[jumpOrigin(rows, cursor, 1, first.length) + 1];
}

test("after the wheel, ] continues from what is on screen (issue #4)", () => {
	const { rows, first } = layout();
	const total = rows.length;
	// `]` twice: the cursor on block 2, three rows below the top of the pane.
	let view: View = { cursor: first[2], scroll: first[2] - 3 };
	view = wheel(view, 10, total);
	view = wheel(view, -6, total);
	const target = nextBlockRow(rows, first, view.cursor);
	assert.ok(target >= view.scroll && target < view.scroll + BODY, `] lands on row ${target}, off the screen at ${view.scroll}-${view.scroll + BODY - 1}`);
	assert.ok(target - view.scroll < BODY / 2, "] goes to the next block near the top, not one further down the screen");
});

test("the wheel leaves the cursor at the reading position near the top of the pane", () => {
	const { rows } = layout();
	const total = rows.length;
	const down = wheel({ cursor: 30, scroll: 20 }, 4, total);
	assert.deepEqual(down, { cursor: 32 + scrollMargin(BODY), scroll: 32 });
	const up = wheel({ cursor: 60, scroll: 40 }, -2, total);
	assert.deepEqual(up, { cursor: 34 + scrollMargin(BODY), scroll: 34 });
});

test("wheeling back to the top puts the cursor on the first row", () => {
	const { rows } = layout();
	assert.deepEqual(wheel({ cursor: 20, scroll: 4 }, -5, rows.length), { cursor: 0, scroll: 0 });
});

test("a wheel notch that can't scroll leaves the cursor alone", () => {
	const { rows } = layout();
	const total = rows.length;
	const bottom = { cursor: total - 1, scroll: total - BODY };
	assert.deepEqual(wheel(bottom, 1, total), bottom);
	assert.deepEqual(wheel({ cursor: 2, scroll: 0 }, -1, total), { cursor: 2, scroll: 0 });
	assert.deepEqual(wheel({ cursor: 3, scroll: 0 }, 2, 20), { cursor: 3, scroll: 0 });
});

test("while selecting, the wheel moves the cursor only as far as it must to stay on screen", () => {
	const { rows } = layout();
	const total = rows.length;
	assert.deepEqual(wheel({ cursor: 25, scroll: 20 }, 1, total, true), { cursor: 25, scroll: 23 });
	assert.deepEqual(wheel({ cursor: 25, scroll: 20 }, 4, total, true), { cursor: 32, scroll: 32 });
	assert.deepEqual(wheel({ cursor: 56, scroll: 20 }, -1, total, true), { cursor: 53, scroll: 17 });
});

test("on the blank row between two blocks, jumps go to the neighbours, not the ends of the document", () => {
	const { rows, first } = layout();
	const gap = first[10] - 1;
	assert.equal(rows[gap].block, -1);
	assert.equal(jumpOrigin(rows, gap, 1, first.length) + 1, 10, "] goes to the block below");
	assert.equal(jumpOrigin(rows, gap, -1, first.length) - 1, 9, "[ goes to the block above");
});

test("on a block's row, jumps count from that block", () => {
	const { rows, first } = layout();
	assert.equal(jumpOrigin(rows, first[5] + 1, 1, first.length), 5);
	assert.equal(jumpOrigin(rows, first[5] + 1, -1, first.length), 5);
	assert.equal(jumpOrigin([], 0, 1, 0), -1);
	assert.equal(jumpOrigin([], 0, -1, 0), 0);
});
