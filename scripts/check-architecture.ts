// CLAUDE.md rules that Biome cannot express; the rest lives in biome.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ALLOWED_SAMPLES, FORBIDDEN, forbiddenIn } from "./module-syntax";

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
// Entity storage is the foundation: it must stay usable without the rest of core.
const ECS = join(ENGINE, "core/ecs") + sep;
const CORE_CONFIG = join(ENGINE, "core/config.ts");
// A module's whole view of the engine: the core API, shared contract types and its own folder.
const API = join(ENGINE, "core/module/api.ts");
const CONTRACTS = join(ENGINE, "contracts") + sep;
const MODULES = join(ENGINE, "modules") + sep;

// `import type` is erased before Bun's scanner sees it, but a type import
// across modules is still coupling. Anchored to statement starts so that
// `Array.from("x")` and comments never match.
const TYPE_IMPORT =
	/^\s*(?:import|export)\s+(?:type\b|\{[^}]*\btype\b)[^;'"]*?\bfrom\s*["']([^"']+)["']/gm;

const WEB = join(ROOT, "apps/web/src") + sep;
const PROTOCOL = "@korr/protocol";
const EVERY_WEB_LAYER = [
	"play",
	"view",
	"input",
	"net",
	"render",
	"ui",
	"debug",
	"theme",
];
// What each web layer may import: `values` in any form, `types` only through `import type` or `export type`.
const WEB_LAYERS = new Map<
	string,
	{ values: readonly string[]; types: readonly string[] }
>([
	["play", { values: [], types: [PROTOCOL] }],
	["view", { values: [], types: [PROTOCOL] }],
	["input", { values: [], types: ["play"] }],
	["net", { values: [], types: ["play", PROTOCOL] }],
	["render", { values: ["theme", "three"], types: ["view", "play"] }],
	["ui", { values: ["theme"], types: ["play"] }],
	["debug", { values: ["theme"], types: ["view", "play"] }],
	["app/client", { values: EVERY_WEB_LAYER, types: [PROTOCOL] }],
	[
		"app/main",
		{ values: [...EVERY_WEB_LAYER, "app/client"], types: [PROTOCOL] },
	],
	["theme", { values: [], types: [] }],
]);

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

// Only `import type` and `export type` are erased under verbatimModuleSyntax: `import { type X }` still loads the module.
const STATIC_IMPORT =
	/^(?:\s|\/\*.*?\*\/)*(?:import|export)\s+(type\s)?[^;'"]*?\bfrom\s*["']([^"']+)["']/gm;

// Type-position `import("x")` is erased like `import type`, so Bun's scanner never sees it.
const IMPORT_TYPE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const webImportsOf = (source: string) => {
	const values = new Set(
		transpiler.scanImports(source).map((entry) => entry.path),
	);
	const types = new Set<string>();
	for (const [, type, spec] of source.matchAll(STATIC_IMPORT))
		if (spec) (type ? types : values).add(spec);
	for (const [, spec] of source.matchAll(IMPORT_TYPE))
		if (spec) types.add(spec);
	return [
		...[...values].map((spec) => ({ spec, typeOnly: false })),
		...[...types]
			.filter((spec) => !values.has(spec))
			.map((spec) => ({ spec, typeOnly: true })),
	];
};

// "play/step.ts" → "play", "app/main.ts" → "app/main", "theme.ts" → "theme".
const webLayer = (path: string) => {
	const parts = relative(WEB, path)
		.replace(/\.tsx?$/, "")
		.split(sep);
	return parts[0] === "app" ? parts.join("/") : (parts[0] ?? "");
};

const packageOf = (spec: string) =>
	spec
		.split("/")
		.slice(0, spec.startsWith("@") ? 2 : 1)
		.join("/");

const checkWebFile = (file: string, source: string) => {
	const layer = webLayer(file);
	const allowed = WEB_LAYERS.get(layer);
	if (!allowed) {
		report(file, `${layer} is not a layer of the web layer matrix`);
		return;
	}
	for (const { spec, typeOnly } of webImportsOf(source)) {
		const target = spec.startsWith(".")
			? webLayer(resolveImport(file, spec))
			: packageOf(spec);
		if (target === layer || allowed.values.includes(target)) continue;
		if (!allowed.types.includes(target))
			report(file, `${layer} must not import ${target}`);
		else if (!typeOnly)
			report(
				file,
				`${layer} may import ${target} only through \`import type\` or \`export type\``,
			);
	}
};

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
	if (
		from.area === "modules" &&
		target !== API &&
		!target.startsWith(CONTRACTS) &&
		!target.startsWith(join(MODULES, from.module ?? "") + sep)
	)
		report(
			file,
			`module ${from.module} imports ${relative(ENGINE, target)}; a module may import only core/module/api.ts, contracts/ and its own folder`,
		);
	if (from.area === "contracts" && to.area !== "contracts")
		report(file, "contracts/ may only import contracts/");
	if (file.startsWith(ECS) && !target.startsWith(ECS) && target !== CORE_CONFIG)
		report(file, "core/ecs/ may only import core/ecs/ and core/config.ts");
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
		if (file.startsWith(WEB)) checkWebFile(file, source);
		if (file.startsWith(MODULES))
			for (const what of new Set(forbiddenIn(source)))
				report(file, `${what} is forbidden in modules/`);
	}
}

// A known violation must still be reported, or an edit to this script could disable the rule unnoticed.
const probe = join(ENGINE, "modules/probe/index.ts");
const before = errors.length;
for (const spec of [
	"../../content/species/rat",
	"../../registry",
	"../../core/engine",
	"../hunger/schema",
	"../../core/module/api",
	"../../contracts",
	"./schema",
])
	checkEngineImport(probe, resolveImport(probe, spec));
if (errors.length - before !== 4)
	report(probe, "the modules import rule did not fire exactly 4 times");
else errors.length = before;

for (const { what, samples } of FORBIDDEN)
	for (const sample of samples)
		if (!forbiddenIn(sample).includes(what))
			report(probe, `the ${what} rule misses "${sample}"`);
for (const what of ALLOWED_SAMPLES.flatMap(forbiddenIn))
	report(probe, `the ${what} rule fires on allowed code`);

const ecsProbe = join(ECS, "probe.ts");
const ecsBefore = errors.length;
for (const spec of ["../engine", "../config", "./ids"])
	checkEngineImport(ecsProbe, resolveImport(ecsProbe, spec));
if (errors.length - ecsBefore !== 1)
	report(
		ecsProbe,
		"the core/ecs -> rest of core rule did not fire exactly once",
	);
else errors.length = ecsBefore;

// A known violation of each web layer rule must still be reported; allowed imports must not be.
const webProbes: [path: string, source: string, fires: number][] = [
	[
		"play/probe.ts",
		'import type { Snapshot } from "@korr/protocol";\nimport { edible } from "./edible";',
		0,
	],
	["play/probe.ts", 'import { notices } from "../theme";', 1],
	["play/probe.ts", 'import { decode } from "@korr/protocol";', 1],
	["view/probe.ts", 'import type { Play } from "../play/types";', 1],
	["view/probe.ts", 'import { decode } from "@korr/protocol";', 1],
	["input/probe.ts", 'import { connect } from "../net/connect";', 1],
	["input/probe.ts", 'import { step } from "../play/step";', 1],
	["net/probe.ts", 'import { asciiView } from "../debug/ascii";', 1],
	["net/probe.ts", 'import { step } from "../play/step";', 1],
	["render/probe.ts", 'import type { Hud } from "../ui/hud";', 1],
	["render/probe.ts", 'import { step } from "../play/step";', 1],
	["ui/probe.ts", 'import { connect } from "../net/connect";', 1],
	["debug/probe.ts", 'import type { Hud } from "../ui/hud";', 1],
	["debug/probe.ts", 'import { step } from "../play/step";', 1],
	["app/client.ts", 'import { decode } from "@korr/protocol";', 1],
	["app/main.ts", 'import { decode } from "@korr/protocol";', 1],
	["app/main.ts", 'import { Scene } from "three";', 1],
	["theme.ts", 'import type { Play } from "./play/types";', 1],
	["ui/probe.ts", 'import type { Snapshot } from "@korr/protocol";', 1],
	["ui/probe.ts", 'import { step } from "../play/step";', 1],
	["ui/probe.ts", 'import { type Play } from "../play/types";', 1],
	["ui/probe.ts", 'export type S = import("@korr/protocol").Snapshot;', 1],
	["ui/probe.ts", '/* hud */ import { type Play } from "../play/types";', 1],
	["debug/probe.ts", 'import type { Link } from "../net/connect";', 1],
	["debug/probe.ts", 'export type L = typeof import("../net/connect");', 1],
	["net/probe.ts", 'import { type ServerMessage } from "@korr/protocol";', 1],
	["app/client.ts", 'import "./main";', 1],
	[
		"app/main.ts",
		'import { createClient } from "./client";\nexport type { Play } from "../play/types";',
		0,
	],
	["probe.ts", "", 1],
];
for (const [path, source, fires] of webProbes) {
	const probe = join(WEB, path);
	const before = errors.length;
	checkWebFile(probe, source);
	if (errors.length - before !== fires)
		report(
			probe,
			`the web layer rules fired ${errors.length - before} times, not ${fires}, on ${JSON.stringify(source)}`,
		);
	else errors.length = before;
}

if (errors.length > 0) {
	console.error(`architecture check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`architecture check passed (${workspaces.length} workspaces)`);
