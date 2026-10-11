import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export const RUST = resolve(import.meta.dir, "../apps/server-rs");
export const SIM = join(RUST, "crates/sim");

// Crate boundaries from rust-structure.md §3: one Cargo.toml line could undo them.
export const MECHANICS = ["biology", "milieu", "combat"].map(
	(d) => join(SIM, d) + sep,
);
const MECHANIC_DEPS = new Set(["korr-core", "korr-contracts", "korr-genome"]);
// A mechanic draws through its core context, so it cannot forge another module's stream.
const RANDOM_USERS = new Set(["korr-core", "korr-genome", "korr-worldgen"]);
const FOUNDATION_DEPS: Record<string, string[]> = {
	"korr-random": [],
	"korr-ecs": [],
	"korr-grid": ["korr-ecs"],
};

type Dependency = string | { package?: string; workspace?: boolean };
export type Dependencies = Record<string, Dependency>;
export type Manifest = {
	package?: { name?: string };
	dependencies?: Dependencies;
	"dev-dependencies"?: Dependencies;
	target?: Record<
		string,
		{ dependencies?: Dependencies; "dev-dependencies"?: Dependencies }
	>;
};

const workspaceDeps = (
	Bun.TOML.parse(readFileSync(join(RUST, "Cargo.toml"), "utf8")) as {
		workspace: { dependencies: Dependencies };
	}
).workspace.dependencies;

// Cargo links target-specific and renamed dependencies like plain ones.
// Foundation tests may link korr-random; a mechanic's tests stay behind its seam.
const linkedDeps = (manifest: Manifest, shared = workspaceDeps, dev = false) =>
	[manifest, ...Object.values(manifest.target ?? {})]
		.flatMap((t) =>
			dev ? [t.dependencies, t["dev-dependencies"]] : [t.dependencies],
		)
		.flatMap((table) => Object.entries(table ?? {}))
		.map(([key, dep]) => {
			const spec = typeof dep === "object" && dep.workspace ? shared[key] : dep;
			return { key, crate: (typeof spec === "object" && spec.package) || key };
		});
export const linkedCrates = (
	manifest: Manifest,
	shared = workspaceDeps,
	dev = false,
) => linkedDeps(manifest, shared, dev).map((dep) => dep.crate);
// The mechanic path rule reads a crate by its own name, which a rename would hide.
const mechanicRenames = (manifest: Manifest, shared = workspaceDeps) =>
	linkedDeps(manifest, shared, true)
		.filter(({ key, crate }) => crate.startsWith("korr-") && key !== crate)
		.map(({ key, crate }) => `a mechanic links ${crate} as ${key}`);

export const crateViolations = (dir: string, name: string, deps: string[]) => {
	const workspace = deps.filter((dep) => dep.startsWith("korr-"));
	if (MECHANICS.some((root) => dir.startsWith(root)))
		return workspace
			.filter((dep) => !MECHANIC_DEPS.has(dep))
			.map((dep) => `a mechanic depends on ${dep}`);
	const found: string[] = [];
	if (workspace.includes("korr-random") && !RANDOM_USERS.has(name))
		found.push("depends on korr-random");
	const allowed = FOUNDATION_DEPS[name];
	if (allowed)
		for (const dep of workspace.filter((d) => !allowed.includes(d)))
			found.push(`depends on ${dep}`);
	return found;
};

export const manifestViolations = (
	dir: string,
	manifest: Manifest,
	shared = workspaceDeps,
) => {
	const mechanic = MECHANICS.some((root) => dir.startsWith(root));
	const deps = linkedCrates(manifest, shared, mechanic);
	return [
		...crateViolations(dir, manifest.package?.name ?? "", deps),
		...(mechanic ? mechanicRenames(manifest, shared) : []),
	];
};
