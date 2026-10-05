// CLAUDE.md rules that Biome cannot express; the rest lives in biome.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

// The bundler accepts extensionless and directory specifiers, so the rules must compare what it loads.
const resolveImport = (file: string, spec: string) => {
	const base = resolve(dirname(file), spec);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	];
	return (
		candidates.find((path) => existsSync(path) && statSync(path).isFile()) ??
		base
	);
};

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
	if (from.area === "modules" && (to.area === "content" || target === REGISTRY))
		report(
			file,
			"modules/ must not import content/ or registry.ts; name species in config",
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
	for (const file of ["src", "test", "bench"].flatMap((sub) =>
		walk(join(dir, sub)),
	)) {
		const source = readFileSync(file, "utf8");

		const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
		if (lines > MAX_LINES)
			report(
				file,
				`${lines} lines (max ${MAX_LINES}): split it into a folder by subject`,
			);

		for (const spec of importsOf(source)) {
			if (!spec.startsWith(".")) continue;
			const target = resolveImport(file, spec);
			if (!target.startsWith(dir + sep))
				report(
					file,
					`relative import "${spec}" leaves its package; import the package`,
				);
			if (file.startsWith(ENGINE)) checkEngineImport(file, target);
		}
	}
}

// A known violation must still be reported, or an edit to this script could disable the rule unnoticed.
const probe = join(ENGINE, "modules/probe/index.ts");
const before = errors.length;
for (const spec of ["../../content/species/rat", "../../registry"])
	checkEngineImport(probe, resolveImport(probe, spec));
if (errors.length - before !== 2)
	report(probe, "the modules -> content/registry rule did not fire");
else errors.length = before;

if (errors.length > 0) {
	console.error(`architecture check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`architecture check passed (${workspaces.length} workspaces)`);
