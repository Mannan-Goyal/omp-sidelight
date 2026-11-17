import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpenable, linkAt, linkSpans, openerCommand, pickLink } from "../src/links.ts";

/** Two columns for CJK ideographs, one for everything else: enough for these rows. */
const width = (grapheme: string): number => (/[\u4e00-\u9fff]/.test(grapheme) ? 2 : 1);

const osc8 = (href: string, text: string, end = "\x07"): string => `\x1b]8;;${href}${end}${text}\x1b]8;;${end}`;

test("a click on an OSC 8 link's label or its (url) suffix finds the link (issue #3)", () => {
	// How pi-tui renders [docs](https://a.dev/x): underlined label, then the URL in parentheses, both hyperlinked.
	const row = `See ${osc8("https://a.dev/x", "\x1b[4mdocs\x1b[24m")} ${osc8("https://a.dev/x", "\x1b[2m(https://a.dev/x)\x1b[22m")} now`;
	assert.equal(linkAt(row, 3, width), undefined);
	assert.equal(linkAt(row, 4, width), "https://a.dev/x");
	assert.equal(linkAt(row, 7, width), "https://a.dev/x");
	assert.equal(linkAt(row, 8, width), undefined, "the space between label and URL is not a link");
	assert.equal(linkAt(row, 9, width), "https://a.dev/x");
	assert.equal(linkAt(row, 25, width), "https://a.dev/x");
	assert.equal(linkAt(row, 26, width), undefined);
});

test("OSC 8 closed with ST and with parameters is read the same way", () => {
	const row = `\x1b]8;id=7;https://b.dev\x1b\\b\x1b]8;;\x1b\\ c`;
	assert.deepEqual(linkSpans(row, width), [{ start: 0, end: 1, href: "https://b.dev" }]);
});

test("wide characters before a link shift its columns", () => {
	const row = `中文 ${osc8("https://c.dev", "c")}`;
	assert.equal(linkAt(row, 5, width), "https://c.dev");
	assert.equal(linkAt(row, 4, width), undefined);
});

test("without OSC 8, a URL in the visible text is still a link, without the bracket and full stop around it", () => {
	const row = "\x1b[4mdocs\x1b[24m (https://a.dev/x_(y)). Mail mailto:me@a.dev";
	assert.deepEqual(linkSpans(row, width), [
		{ start: 6, end: 25, href: "https://a.dev/x_(y)" },
		{ start: 33, end: 48, href: "mailto:me@a.dev" },
	]);
});

test("a URL the renderer already hyperlinked is not counted twice", () => {
	const row = osc8("https://a.dev", "https://a.dev");
	assert.deepEqual(linkSpans(row, width), [{ start: 0, end: 13, href: "https://a.dev" }]);
});

test("only web and mail links are handed to the system", () => {
	assert.ok(isOpenable("https://a.dev/x?y=1&z=2"));
	assert.ok(isOpenable("http://a.dev"));
	assert.ok(isOpenable("mailto:me@a.dev"));
	assert.ok(!isOpenable("file:///Applications/Calculator.app"));
	assert.ok(!isOpenable("javascript:alert(1)"));
	assert.ok(!isOpenable("./notes.md"));
	assert.ok(!isOpenable("https://"));
});

test("the opener takes the URL as one argument, with no shell in between", () => {
	const url = "https://a.dev/?q=1&r=$(x)";
	assert.deepEqual(openerCommand("darwin", url), { command: "open", args: [url] });
	assert.deepEqual(openerCommand("linux", url), { command: "xdg-open", args: [url] });
	assert.deepEqual(openerCommand("win32", url), { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] });
});

test("every digit answers the link question, so one past the list never reaches quick ask", () => {
	const links = ["https://a.dev", "https://b.dev"];
	assert.deepEqual(pickLink(links, "2"), { answered: true, href: "https://b.dev" });
	for (const key of ["3", "6", "9"]) assert.deepEqual(pickLink(links, key), { answered: true, href: undefined }, key);
	for (const key of ["0", "j", "a", "12"]) assert.equal(pickLink(links, key).answered, false, key);
});
