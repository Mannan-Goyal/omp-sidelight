import assert from "node:assert/strict";
import { test } from "node:test";
import { displaySource, referenceDefinitions, renderSource, splitBlocks } from "../src/blocks.ts";

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

const REFS = `# Links

Read [the spec][spec], the [Guide][] and [faq].

- a list item pointing at [the spec][spec]

[spec]: https://example.com/spec "The spec"
[guide]: <https://example.com/guide>
[faq]:
  https://example.com/faq

\`\`\`md
[not]: https://example.com/inside-code
\`\`\`
`;

test("a reference link in one block gets the definitions from another (issue #3)", () => {
	const blocks = splitBlocks(REFS);
	const definitions = referenceDefinitions(blocks);
	// One line each and no title: the only form omp's renderer reads.
	assert.equal(definitions, ["[spec]: https://example.com/spec", "[guide]: <https://example.com/guide>", "[faq]: https://example.com/faq"].join("\n"));
	const paragraph = blocks.find(block => block.kind === "paragraph")!;
	assert.equal(renderSource(paragraph, definitions), `${definitions}\n\nRead [the spec][spec], the [Guide][] and [faq].`);
	const list = blocks.find(block => block.kind === "list")!;
	assert.ok(renderSource(list, definitions).startsWith(`${definitions}\n\n- a list item`));
});

test("a paragraph of definitions shows nothing, and its lines are never joined into one", () => {
	const definitionsOnly = splitBlocks(REFS).find(block => block.source.startsWith("[spec]:"))!;
	assert.equal(displaySource(definitionsOnly), "");
	const [mixed] = splitBlocks("[a]: https://a.dev\n[b]: https://b.dev\nThen some\ntext.");
	assert.equal(displaySource(mixed), "Then some text.");
});

test("text that only looks like a definition stays text", () => {
	for (const source of ["[note]: this is important", "Some text\n[a]: https://a.dev", "[a]: https://a.dev trailing words", "[ ]: https://a.dev"]) {
		const [block] = splitBlocks(source);
		assert.equal(referenceDefinitions([block]), "", source);
		assert.equal(displaySource(block), source.replace("\n", " "), source);
	}
});

test("blocks that can't hold a link render unchanged", () => {
	const blocks = splitBlocks(REFS);
	const definitions = referenceDefinitions(blocks);
	const code = blocks.find(block => block.kind === "code")!;
	assert.equal(renderSource(code, definitions), code.source);
	const heading = blocks.find(block => block.kind === "heading")!;
	assert.equal(renderSource(heading, definitions), "# Links");
	assert.equal(renderSource(blocks[1], ""), displaySource(blocks[1]));
});

test("a label defined twice keeps its first definition, whatever the case", () => {
	const blocks = splitBlocks("[x]: https://first.dev\n[X]: https://second.dev\n\nSee [x].\n\n[ x ]: https://third.dev");
	assert.equal(referenceDefinitions(blocks), "[x]: https://first.dev");
});

test("only paragraphs give definitions; a code block starting with one doesn't", () => {
	const [paragraph] = splitBlocks("[a]: https://a.dev");
	assert.equal(referenceDefinitions([paragraph]), "[a]: https://a.dev");
	for (const kind of ["code", "list", "quote", "table", "heading", "hr"] as const) {
		assert.equal(referenceDefinitions([{ ...paragraph, kind }]), "", kind);
	}
});
