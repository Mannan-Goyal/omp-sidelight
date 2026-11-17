/** Where the document pane is: the cursor row and the first visible row. */
export interface View {
	cursor: number;
	scroll: number;
}

/** Rows kept between the cursor and the pane's top or bottom edge, as in vim's `scrolloff`. */
export const SCROLL_MARGIN = 3;

export function scrollMargin(body: number): number {
	return Math.min(SCROLL_MARGIN, Math.floor(body / 4));
}

/** Keep the cursor on a row and the pane inside the document. */
export function clampView(view: View, total: number, body: number): View {
	return {
		cursor: Math.max(0, Math.min(view.cursor, total - 1)),
		scroll: Math.max(0, Math.min(view.scroll, Math.max(0, total - body))),
	};
}

/** Scroll just enough that the cursor sits at least the margin away from the pane's edges. */
export function revealCursor(view: View, total: number, body: number): View {
	const margin = scrollMargin(body);
	let scroll = view.scroll;
	if (view.cursor < scroll + margin) scroll = view.cursor - margin;
	if (view.cursor > scroll + body - 1 - margin) scroll = view.cursor - body + 1 + margin;
	return clampView({ cursor: view.cursor, scroll }, total, body);
}

/**
 * The view after the mouse wheel scrolls the pane by `delta` rows. The cursor
 * moves to the reading position near the top of what is now on screen, so
 * keyboard moves and block jumps carry on from there. While a selection is
 * being made the cursor is its moving end, so it only moves as far as it must
 * to stay on screen.
 */
export function wheelView(view: View, delta: number, total: number, body: number, selecting: boolean): View {
	const current = clampView(view, total, body);
	const { scroll } = clampView({ cursor: current.cursor, scroll: current.scroll + delta }, total, body);
	if (scroll === current.scroll) return current;
	if (selecting) {
		const cursor = Math.max(scroll, Math.min(current.cursor, scroll + body - 1));
		return clampView({ cursor, scroll }, total, body);
	}
	const cursor = scroll === 0 ? 0 : scroll + scrollMargin(body);
	return clampView({ cursor, scroll }, total, body);
}

/**
 * The block a jump counts from, given the rendered rows (`block` is -1 on the
 * blank row between two blocks). On a blank row, a jump forward counts from
 * the block above it and a jump back from the block below it, so either way
 * it lands on a neighbour instead of the document's first or last block.
 */
export function jumpOrigin(rows: ReadonlyArray<{ block: number }>, row: number, direction: 1 | -1, blockCount: number): number {
	const here = rows[row]?.block ?? -1;
	if (here >= 0) return here;
	for (let r = row - direction; r >= 0 && r < rows.length; r -= direction) {
		if (rows[r].block >= 0) return rows[r].block;
	}
	return direction > 0 ? -1 : blockCount;
}
