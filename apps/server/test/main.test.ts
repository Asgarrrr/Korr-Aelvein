import { expect, test } from "bun:test";
import { connect } from "./client";

const START_TIMEOUT_MS = 5000;

const start = (seed: string) =>
	Bun.spawn(["bun", "src/main.ts"], {
		cwd: `${import.meta.dir}/..`,
		env: { ...process.env, PORT: "0", SEED: seed },
		stdout: "pipe",
		stderr: "pipe",
		timeout: START_TIMEOUT_MS,
	});

// A malformed SEED would start a game on a seed nobody chose.
test.each([
	"abc",
	"",
	"1.5",
	"Infinity",
	" ",
	"0x10",
	"1e3",
	"9007199254740993",
])("SEED=%j stops the server at startup", async (seed) => {
	const child = start(seed);
	const err = await new Response(child.stderr).text();
	await child.exited;
	expect(err).toContain("SEED must be an integer");
	expect(child.exitCode).not.toBe(0);
});

const openingFor = async (seed: string) => {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() });
	const port = probe.port;
	probe.stop(true);
	const child = Bun.spawn(["bun", "src/main.ts"], {
		cwd: `${import.meta.dir}/..`,
		env: { ...process.env, PORT: String(port), SEED: seed },
		stdout: "pipe",
		stderr: "pipe",
		timeout: START_TIMEOUT_MS,
	});
	try {
		const decoder = new TextDecoder();
		let out = "";
		for await (const chunk of child.stdout) {
			out += decoder.decode(chunk);
			if (out.includes("server listening")) break;
		}
		const client = await connect(port);
		const opening = await client.next();
		client.close();
		return opening;
	} finally {
		child.kill();
		await child.exited;
	}
};

test("SEED reaches the game: same seed gives the same opening, another seed does not", async () => {
	const first = await openingFor("7");
	expect(await openingFor("7")).toEqual(first);
	expect(await openingFor("8")).not.toEqual(first);
});
