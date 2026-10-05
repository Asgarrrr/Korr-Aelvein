// Enforces the structural rules of CLAUDE.md that Biome cannot express:
// the module graph inside the engine, relative imports escaping their
// package, and the file size limit. Undeclared dependencies, Node modules
// and determinism are Biome rules (see biome.json).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const MAX_LINES = 400;

const workspaces = ["apps", "packages"].flatMap((group) =>
	readdirSync(join(ROOT, group))
		.map((entry) => join(ROOT, group, entry))
		.filter((dir) => existsSync(join(dir, "package.json"))),
);

const ENGINE = join(ROOT, "packages/engine/src") + sep;
// The composition root: the only file outside modules/ allowed to import them.
const REGISTRY = join(ENGINE, "registry.ts");

// `import type` is erased before Bun's scanner sees it, but a type import
// across modules is still coupling. Anchored to statement starts so that
// `Array.from("x")` and comments never match.
const TYPE_IMPORT =
	/^\s*(?:import|export)\s+(?:type\b|\{[^}]*\btype\b)[^;'"]*?\bfrom\s*["']([^"']+)["']/gm;

const transpiler = new Bun.Transpiler({ loader: "tsx" });

const errors: string[] = [];
const report = (file: string, message: string) =>
	errors.push(`${relative(ROOT, file)}: ${message}`);

const walk = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) return walk(path);
				return /\.tsx?$/.test(entry.name) ? [path] : [];
			})
		: [];

const importsOf = (source: string) => [
	...transpiler.scanImports(source).map((entry) => entry.path),
	...[...source.matchAll(TYPE_IMPORT)].flatMap(([, spec]) =>
		spec ? [spec] : [],
	),
];

// "modules/hunger/x.ts" → area "modules", module "hunger".
const engineArea = (file: string) => {
	const [area, name] = relative(ENGINE, file).split(sep);
	return { area, module: area === "modules" ? name : undefined };
};

const checkEngineImport = (file: string, target: string) => {
	if (!target.startsWith(ENGINE)) return;
	const from = engineArea(file);
	const to = engineArea(target);
	if (
		to.area === "modules" &&
		!["modules", "content"].includes(from.area ?? "") &&
		file !== REGISTRY
	)
		report(
			file,
			`${from.area} must not import modules/; only registry.ts and content/ may`,
		);
	if (from.module && to.module && from.module !== to.module)
		report(
			file,
			`module ${from.module} imports module ${to.module}; use contracts/ or events`,
		);
	if (from.area === "contracts" && to.area !== "contracts")
		report(file, "contracts/ may only import contracts/");
};

for (const dir of workspaces) {
	for (const file of [...walk(join(dir, "src")), ...walk(join(dir, "test"))]) {
		const source = readFileSync(file, "utf8");

		const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
		if (lines > MAX_LINES)
			report(
				file,
				`${lines} lines (max ${MAX_LINES}): split it into a folder by subject`,
			);

		for (const spec of importsOf(source)) {
			if (!spec.startsWith(".")) continue;
			const target = resolve(dirname(file), spec);
			if (!target.startsWith(dir + sep))
				report(
					file,
					`relative import "${spec}" leaves its package; import the package`,
				);
			if (file.startsWith(ENGINE)) checkEngineImport(file, target);
		}
	}
}

if (errors.length > 0) {
	console.error(`architecture check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`architecture check passed (${workspaces.length} workspaces)`);
