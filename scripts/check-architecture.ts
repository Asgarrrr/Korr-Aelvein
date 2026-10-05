// Enforces the placement and boundary rules of CLAUDE.md. A rule that no
// tool checks ends up violated, so every rule here fails `bun run verify`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const MAX_LINES = 400;

type Workspace = { name: string; dir: string; allowed: Set<string> };

const workspaces: Workspace[] = ["apps", "packages"].flatMap((group) =>
	readdirSync(join(ROOT, group))
		.map((entry) => join(ROOT, group, entry))
		.filter((dir) => existsSync(join(dir, "package.json")))
		.map((dir) => {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			return { name: pkg.name, dir, allowed: new Set(Object.keys(deps)) };
		}),
);

const ENGINE = join(ROOT, "packages/engine/src") + sep;
// The composition root: the only file outside modules/ allowed to import them.
const REGISTRY = join(ENGINE, "registry.ts");
const WEB_THEME = join(ROOT, "apps/web/src/theme.ts");

// Precision of these differs between JS engines; the sim must replay identically.
const NONDETERMINISTIC =
	/\bMath\s*(\.\s*(random|pow|exp|expm1|log|log1p|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot)\b|\[)|\bDate\s*(\.\s*now\b|\()|\bnew\s+Date\b|\bperformance\.now\b|\bcrypto\.(getRandomValues|randomUUID)\b/;
const COLOR_LITERAL =
	/["'`]#[0-9a-fA-F]{3,8}["'`]|\b0x[0-9a-fA-F]{6}\b|\b(rgba?|hsla?)\(/;
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
	if (to.area === "modules" && from.area !== "modules" && file !== REGISTRY)
		report(
			file,
			`${from.area} must not import modules/; only registry.ts wires modules in`,
		);
	if (from.module && to.module && from.module !== to.module)
		report(
			file,
			`module ${from.module} imports module ${to.module}; use contracts/ or events`,
		);
	if (from.area === "contracts" && to.area !== "contracts")
		report(file, "contracts/ may only import contracts/");
};

for (const ws of workspaces) {
	const files = [...walk(join(ws.dir, "src")), ...walk(join(ws.dir, "test"))];
	for (const file of files) {
		const source = readFileSync(file, "utf8");
		// Comments and types stripped, so a comment never triggers a rule.
		const code = transpiler.transformSync(source);
		const isEngineSrc = file.startsWith(ENGINE);
		const isTest = relative(ws.dir, file).split(sep)[0] === "test";

		const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
		if (lines > MAX_LINES)
			report(
				file,
				`${lines} lines (max ${MAX_LINES}): split it into a folder by subject`,
			);

		if (isEngineSrc && NONDETERMINISTIC.test(code))
			report(
				file,
				"nondeterministic call in the engine: use the seeded RNG and integer math",
			);

		if (
			ws.name === "@korr/web" &&
			file !== WEB_THEME &&
			COLOR_LITERAL.test(code)
		)
			report(file, "color literal outside apps/web/src/theme.ts");

		for (const spec of importsOf(source)) {
			if (spec.startsWith(".")) {
				const target = resolve(dirname(file), spec);
				if (!target.startsWith(ws.dir + sep))
					report(
						file,
						`relative import "${spec}" leaves ${ws.name}; import the package`,
					);
				if (isEngineSrc) checkEngineImport(file, target);
				continue;
			}
			if (spec.startsWith("bun:")) continue;
			const pkg = spec.startsWith("@")
				? spec.split("/").slice(0, 2).join("/")
				: spec.split("/")[0];
			if (ws.name === "@korr/engine" && !isTest)
				report(file, `engine imports "${spec}"; the engine depends on nothing`);
			else if (pkg && !pkg.startsWith("node:") && !ws.allowed.has(pkg))
				report(file, `"${pkg}" is not a dependency of ${ws.name}`);
		}
	}
}

if (errors.length > 0) {
	console.error(`architecture check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`architecture check passed (${workspaces.length} workspaces)`);
