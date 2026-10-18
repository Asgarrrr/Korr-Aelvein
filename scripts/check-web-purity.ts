// Proves that biome.json loads web-purity.grit for the pure web layers: a silently dead rule would keep `verify` green.
import { globSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB = join(ROOT, "apps/web/src");

const samples: [path: string, source: string, fires: number][] = [
	["play/probe-allowed.ts", "export const a = Math.max(1, Math.abs(-2));", 0],
	["input/probe-allowed.ts", "export const a = Math.floor(1.5);", 0],
	["net/probe-clock.ts", "export const a = Date.now() + Math.random();", 0],
	["play/probe-random.ts", "export const a = Math.random();", 1],
	["play/probe-date.ts", "export const a = new Date();", 1],
	["play/probe-key.ts", 'export const a = Math["random"]();', 1],
	[
		"play/probe-destructure.ts",
		"const { random } = Math;\nexport const a = random();",
		1,
	],
	["view/probe-date.ts", "export const a = Date.now();", 1],
	["input/probe-global.ts", "export const a = globalThis.Math.random();", 1],
	["input/probe-alias.ts", "const M = Math;\nexport const a = M.random();", 1],
];

// An interrupted run leaves its probe files behind, and they would fail biome.
for (const stale of globSync("{play,input,net,view}/probe-*.ts", { cwd: WEB }))
	rmSync(join(WEB, stale), { force: true });

const files = samples.map(([path]) => join(WEB, path));
const errors: string[] = [];
try {
	for (const [path, source] of samples)
		writeFileSync(join(WEB, path), `${source}\n`);
	const run = Bun.spawnSync(
		[
			join(ROOT, "node_modules/.bin/biome"),
			"lint",
			...files,
			"--reporter=json",
			"--colors=off",
		],
		{ cwd: ROOT, stderr: "ignore" },
	);
	const { diagnostics } = JSON.parse(run.stdout.toString()) as {
		diagnostics: { category: string; location: { path: string } }[];
	};
	for (const [path, , fires] of samples) {
		const found = diagnostics.filter(
			(d) =>
				d.category === "plugin" &&
				d.location.path === relative(ROOT, join(WEB, path)),
		).length;
		if (found !== fires)
			errors.push(
				`${path}: web-purity.grit fired ${found} times, not ${fires}`,
			);
	}
} finally {
	for (const file of files) rmSync(file, { force: true });
}

if (errors.length > 0) {
	console.error(`web purity check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`web purity check passed (${samples.length} samples)`);
