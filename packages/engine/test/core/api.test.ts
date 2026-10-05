import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as api from "../../src/core/api";

const DECLARATION =
	/^export\s+(?:declare\s+)?(?:interface|type|const|function|class)\s+(\w+)/gm;
const RE_EXPORT = /^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"[^"]+";/gm;

// Every name a module source exports, types included, and every `export` it cannot read:
// `export *`, a local `export { }` list or anything else would hide names from the pin.
const scan = (source: string) => {
	const names: string[] = [];
	const read = new Set<number>();
	for (const match of source.matchAll(DECLARATION)) {
		read.add(match.index);
		names.push(match[1] ?? "");
	}
	for (const match of source.matchAll(RE_EXPORT)) {
		read.add(match.index);
		for (const item of (match[1] ?? "").split(",")) {
			const name = item.replace(/^\s*type\s+/, "").trim();
			if (name !== "") names.push(name.split(/\s+as\s+/).at(-1) ?? "");
		}
	}
	const unread = [...source.matchAll(/^export\b.*$/gm)]
		.filter((match) => !read.has(match.index))
		.map((match) => match[0]);
	return { names: names.sort(), unread };
};

const source = readFileSync(
	new URL("../../src/core/api.ts", import.meta.url),
	"utf8",
);

test("the core API exports exactly the frozen names, all in forms the scan reads", () => {
	const { names, unread } = scan(source);
	expect(unread).toEqual([]);
	expect(names).toEqual([
		"ALTERNATE",
		"ActionCtx",
		"ActionFn",
		"ActionRef",
		"AnyModule",
		"Builder",
		"Candidates",
		"Cell",
		"CellColumns",
		"CellField",
		"CellReadView",
		"CellReader",
		"CellView",
		"CellWriter",
		"ContractView",
		"EntityId",
		"EventRef",
		"FAIL",
		"FieldView",
		"ModuleDef",
		"NONE",
		"NO_CELL",
		"NO_ENTITY",
		"PERCEPTION_RADIUS",
		"Perception",
		"ProposeFn",
		"Query",
		"ReadCtx",
		"ReadView",
		"Schema",
		"Sentinel",
		"Slot",
		"SlotList",
		"SpeciesRef",
		"SpeciesShape",
		"TargetKind",
		"TargetOf",
		"TickFn",
		"WriteCtx",
		"defineModule",
	]);
});

test("the scan sees every runtime export", () => {
	const { names } = scan(source);
	for (const name of Object.keys(api)) expect(names).toContain(name);
});

test("the scan reports every export form it cannot read", () => {
	for (const line of [
		'export * from "./ecs/ids";',
		'export type * from "./ecs/ids";',
		'export * as ids from "./ecs/ids";',
		"export { FAIL };",
		"export { FAIL as GIVE_UP };",
		"export default defineModule;",
		"export = api;",
	])
		expect(scan(`export const A = 1;\n${line}\n`).unread).toEqual([line]);
});

test("the core API's sentinel values are frozen", () => {
	const { FAIL, ALTERNATE, NONE, NO_CELL, NO_ENTITY } = api;
	const values: Record<string, number> = {
		FAIL,
		ALTERNATE,
		NONE,
		NO_CELL,
		NO_ENTITY,
	};
	expect(values).toEqual({
		FAIL: -1,
		ALTERNATE: -2,
		NONE: -1,
		NO_CELL: -1,
		NO_ENTITY: 0,
	});
});
