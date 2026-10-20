/** The rows of a pane a scrollbar thumb covers: `start` is the first, `size` how many. */
export interface Thumb {
	start: number;
	size: number;
}

/**
 * Where the scrollbar thumb sits for a pane `height` rows tall showing rows
 * `scroll … scroll + height - 1` of a document `total` rows long.
 *
 * The thumb's share of the pane is the share of the document on screen, so its
 * size tells the reader how long the document is. Whenever the pane leaves room
 * for a middle position, the thumb touches the top only while the first row is
 * visible and the bottom only while the last row is. Returns `null` when
 * everything fits and there is nothing to scroll.
 */
export function scrollThumb(total: number, height: number, scroll: number): Thumb | null {
	if (height <= 1 || total <= height) return null;
	// Never the whole pane: height² / total rounds to at most height - 1 once total > height.
	const size = Math.max(1, Math.round((height * height) / total));
	const travel = height - size;
	const maxScroll = total - height;
	const offset = Math.max(0, Math.min(scroll, maxScroll));
	let start = Math.round((offset / maxScroll) * travel);
	// Rounding must not make a scrolled document look unscrolled, or the reverse.
	if (travel >= 2) {
		if (offset > 0 && start === 0) start = 1;
		if (offset < maxScroll && start === travel) start = travel - 1;
	}
	return { start, size };
}
