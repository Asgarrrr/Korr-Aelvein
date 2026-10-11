// CLAUDE.md rules that Biome cannot express; the rest lives in biome.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	crateViolations,
	type Dependencies,
	linkedCrates,
	type Manifest,
	MECHANICS,
	manifestViolations,
	RUST,
	SIM,
} from "./crate-deps";
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

const transpiler = new Bun.Transpiler({ loader: "tsx" });

const errors: string[] = [];
const report = (file: string, message: string) =>
	errors.push(`${relative(ROOT, file)}: ${message}`);

const walk = (dir: string, pattern = /\.tsx?$/): string[] =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
				const path = join(dir, entry.name);
				if (entry.isDirectory())
					return entry.name === "target" ? [] : walk(path, pattern);
				return pattern.test(entry.name) ? [path] : [];
			})
		: [];

const lineCount = (source: string) =>
	source.split("\n").length - (source.endsWith("\n") ? 1 : 0);

const checkSize = (file: string, source: string) => {
	const lines = lineCount(source);
	if (lines > MAX_LINES)
		report(
			file,
			`${lines} lines (max ${MAX_LINES}): split it into a folder by subject`,
		);
};

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
		checkSize(file, source);

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
		if (file.startsWith(MODULES))
			for (const what of new Set(forbiddenIn(source)))
				report(file, `${what} is forbidden in modules/`);
	}
}

// Rules from docs/plans/rust-structure.md §4 that cargo cannot express.
// Anchored to a line start so a comment or a `#[deny]` on one item never counts.
const DENY_FLOATS = /^#!\[deny\([^\]]*\bclippy::float_arithmetic\b[^\]]*\)\]/m;

for (const file of walk(RUST, /\.rs$/))
	checkSize(file, readFileSync(file, "utf8"));

// Clippy reads only the nearest clippy.toml and never merges files.
const clippyConfigs = walk(SIM, /^clippy\.toml$/);
if (clippyConfigs.length !== 1 || clippyConfigs[0] !== join(SIM, "clippy.toml"))
	report(
		SIM,
		`expected exactly one clippy.toml, at its root; found ${clippyConfigs.map((file) => relative(ROOT, file)).join(", ") || "none"}`,
	);
for (const config of [
	join(ROOT, ".cargo/config.toml"),
	join(RUST, ".cargo/config.toml"),
])
	if (
		existsSync(config) &&
		readFileSync(config, "utf8").includes("CLIPPY_CONF_DIR")
	)
		report(config, "CLIPPY_CONF_DIR overrides the sim clippy.toml");

const simCrates = walk(SIM, /^Cargo\.toml$/).map(dirname);

// A crate cannot add lints on top of `lints.workspace = true` (cargo#13157).
for (const crate of simCrates) {
	const lib = join(crate, "src/lib.rs");
	if (existsSync(lib) && !DENY_FLOATS.test(readFileSync(lib, "utf8")))
		report(lib, "missing #![deny(clippy::float_arithmetic)]");
}

const HOST = join(RUST, "crates/host") + sep;
const HOST_TOOLS = join(HOST, "tools") + sep;
let hostCrates = 0;
for (const crate of walk(join(RUST, "crates"), /^Cargo\.toml$/).map(dirname)) {
	if (crate.startsWith(HOST_TOOLS)) continue;
	if (crate.startsWith(HOST)) hostCrates++;
	const manifest = Bun.TOML.parse(
		readFileSync(join(crate, "Cargo.toml"), "utf8"),
	) as Manifest;
	for (const found of manifestViolations(crate, manifest))
		report(join(crate, "Cargo.toml"), found);
}

// A mechanic sees the module seam only: the host path would hand it the world.
const HOST_PATH = /\bkorr_core\s*(?:::(?!\s*mechanic\b)|as\b)/;
let mechanicSources = 0;
for (const root of MECHANICS)
	for (const file of walk(root, /\.rs$/)) {
		mechanicSources++;
		if (HOST_PATH.test(readFileSync(file, "utf8")))
			report(file, "a mechanic names korr_core outside korr_core::mechanic");
	}
if (mechanicSources === 0)
	report(SIM, "the mechanic path rule checked no source");
for (const [sample, fires] of [
	["use korr_core::mechanic::{Cost, Module};", false],
	["use korr_core::\n    mechanic::Cost;", false],
	["use korr_core::host::World;", true],
	["use korr_core::{mechanic::Cost, host::World};", true],
	["use korr_core as core;", true],
	["fn f(_: korr_core :: host::Floor) {}", true],
] as const)
	if (HOST_PATH.test(sample) !== fires)
		report(SIM, `the mechanic path rule misreads "${sample}"`);

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

if (
	!DENY_FLOATS.test("#![no_std]\n#![deny(clippy::float_arithmetic)]\n") ||
	DENY_FLOATS.test("// #![deny(clippy::float_arithmetic)]\n") ||
	DENY_FLOATS.test("#![deny(clippy::float_cmp)]\n")
)
	report(SIM, "the float_arithmetic rule misreads a lib.rs header");

if (hostCrates === 0) report(HOST, "the crate rule checked no host crate");

const renamed = linkedCrates(
	Bun.TOML.parse(
		'[dependencies]\nengine = { package = "korr-engine", path = "x" }\n[target."cfg(unix)".dependencies]\nrng.workspace = true\n',
	) as Manifest,
	{ rng: { package: "korr-random" } },
);
const testOnly =
	'[dev-dependencies]\nkorr-engine.workspace = true\n[target."cfg(unix)".dev-dependencies]\nkorr-random.workspace = true\n';
const mechanicProbe = join(SIM, "biology/ethology/probe");
const manifestProbes: [string, string, Dependencies, number][] = [
	[
		mechanicProbe,
		'[dependencies]\nkc = { package = "korr-core", path = "x" }\nkorr-genome.workspace = true\nshared.workspace = true\nrng = { package = "rand", version = "1" }\n',
		{ "korr-genome": {}, shared: { package: "korr-core" } },
		2,
	],
	[mechanicProbe, testOnly, {}, 2],
	[
		mechanicProbe,
		'[dev-dependencies]\nkc = { package = "korr-core", path = "x" }\n',
		{},
		1,
	],
	[
		join(SIM, "grid"),
		'[dependencies]\ne = { package = "korr-ecs", path = "x" }\n',
		{},
		0,
	],
	[join(SIM, "grid"), testOnly, {}, 0],
];
for (const [dir, toml, shared, expected] of manifestProbes) {
	const manifest = Bun.TOML.parse(toml) as Manifest;
	const fired = manifestViolations(dir, manifest, shared).length;
	if (fired !== expected)
		report(
			dir,
			`the manifest rules fired ${fired} times, expected ${expected}`,
		);
}
const crateProbes: [string, string, string[], number][] = [
	[mechanicProbe, "korr-probe", renamed, 2],
	[
		mechanicProbe,
		"korr-probe",
		["korr-core", "korr-contracts", "korr-genome"],
		0,
	],
	[join(SIM, "grid"), "korr-grid", ["korr-ecs", "korr-core", "thiserror"], 1],
	[join(SIM, "core"), "korr-core", ["korr-ecs", "korr-grid", "korr-random"], 0],
	[join(RUST, "crates/host/server"), "korr-server", ["korr-random"], 1],
];
for (const [dir, name, deps, expected] of crateProbes) {
	const fired = crateViolations(dir, name, deps).length;
	if (fired !== expected)
		report(dir, `the crate rule fired ${fired} times, expected ${expected}`);
}

if (errors.length > 0) {
	console.error(`architecture check failed (${errors.length}):`);
	for (const error of errors) console.error(`  ${error}`);
	process.exit(1);
}
console.log(`architecture check passed (${workspaces.length} workspaces)`);
