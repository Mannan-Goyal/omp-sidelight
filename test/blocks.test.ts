import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBlocks } from "../src/blocks.ts";

const DOC = `# Title

Intro paragraph
over two lines.

## Section A

- one
- two

| a | b |
|---|---|
| 1 | 2 |

\`\`\`ts
const x = 1;

const y = 2;
\`\`\`

## Section B

> a quote
`;

test("splits markdown into typed blocks, keeping fenced code with blank lines whole", () => {
	const kinds = splitBlocks(DOC).map(block => block.kind);
	assert.deepEqual(kinds, ["heading", "paragraph", "heading", "list", "table", "code", "heading", "quote"]);
	const code = splitBlocks(DOC).find(block => block.kind === "code");
	assert.match(code?.source ?? "", /const y = 2;/);
});

test("each block knows the heading trail it sits under", () => {
	const blocks = splitBlocks(DOC);
	assert.deepEqual(blocks.find(block => block.kind === "table")?.headings, ["Title", "Section A"]);
	assert.deepEqual(blocks.find(block => block.kind === "quote")?.headings, ["Title", "Section B"]);
});

test("editing one block changes only that block's hash, so change markers and anchors stay put", () => {
	const before = splitBlocks(DOC);
	const after = splitBlocks(DOC.replace("- two", "- two, edited"));
	const changed = after.filter((block, i) => block.hash !== before[i].hash).map(block => block.kind);
	assert.deepEqual(changed, ["list"]);
});

test("the same text under a different kind is a different block", () => {
	const [heading] = splitBlocks("# Same");
	const [paragraph] = splitBlocks("Same");
	assert.notEqual(heading.hash, paragraph.hash);
});
