import assert from "node:assert/strict";
import { test } from "node:test";
import { scrollThumb } from "../src/scrollbar.ts";

test("no scrollbar when the whole document fits", () => {
	assert.equal(scrollThumb(20, 20, 0), null);
	assert.equal(scrollThumb(5, 20, 0), null);
});

test("the thumb's share of the pane matches the share of the document on screen", () => {
	assert.equal(scrollThumb(100, 20, 0)?.size, 4);
	assert.equal(scrollThumb(40, 20, 0)?.size, 10);
});

test("a very long document still gets a visible thumb, and a barely-scrollable one leaves room to move", () => {
	assert.equal(scrollThumb(100_000, 20, 0)?.size, 1);
	assert.equal(scrollThumb(21, 20, 0)?.size, 19);
});

test("the thumb touches the top at the start and the bottom at the end", () => {
	assert.deepEqual(scrollThumb(100, 20, 0), { start: 0, size: 4 });
	assert.deepEqual(scrollThumb(100, 20, 80), { start: 16, size: 4 });
});

test("one row away from either end, the thumb no longer touches that end", () => {
	for (const [total, height] of [[100, 20], [1000, 30], [2000, 40], [5000, 25]]) {
		const max = total - height;
		assert.ok(scrollThumb(total, height, 1)!.start > 0, `${total}/${height}: one row down`);
		const last = scrollThumb(total, height, max - 1)!;
		assert.ok(last.start + last.size < height, `${total}/${height}: one row up from the end`);
	}
});

test("the thumb moves down as the document scrolls and stays inside the pane", () => {
	const total = 337;
	const height = 23;
	let previous = -1;
	for (let scroll = 0; scroll <= total - height; scroll++) {
		const thumb = scrollThumb(total, height, scroll)!;
		assert.ok(thumb.start >= previous, `moved up at scroll ${scroll}`);
		assert.ok(thumb.start >= 0 && thumb.start + thumb.size <= height, `outside the pane at scroll ${scroll}`);
		previous = thumb.start;
	}
});

test("a scroll position past either end is treated as that end", () => {
	assert.deepEqual(scrollThumb(100, 20, -5), scrollThumb(100, 20, 0));
	assert.deepEqual(scrollThumb(100, 20, 500), scrollThumb(100, 20, 80));
});
