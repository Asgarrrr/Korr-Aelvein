import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "../src");
const specifier = /["'`]@korr\/protocol(?:\/[^"'`]*)?["'`]/g;
// `import { type X }` still emits `import {} from`, which loads the module at runtime.
const typeOnly = /\b(?:import|export)\s+type\s[^;'"`]*\bfrom\s*$/;

test("apps/web/src imports only types from @korr/protocol", () => {
	const offenders: string[] = [];
	for (const file of new Bun.Glob("**/*.{ts,tsx}").scanSync(src)) {
		const source = readFileSync(join(src, file), "utf8");
		for (const match of source.matchAll(specifier)) {
			if (typeOnly.test(source.slice(0, match.index))) continue;
			const line = source.slice(0, match.index).split("\n").length;
			offenders.push(`${file}:${line}`);
		}
	}
	expect(offenders).toEqual([]);
});
