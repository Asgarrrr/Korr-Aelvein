import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

// A port pair per checkout, so two worktrees can run the suite at once.
const base =
	10000 +
	(createHash("sha256")
		.update(import.meta.dirname)
		.digest()
		.readUInt16BE(0) %
		20000);
const serverPort = base;
const webPort = base + 1;
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
	testDir: "test",
	testMatch: "**/*.e2e.ts",
	forbidOnly: true,
	retries: 0,
	reporter: "dot",
	use: {
		baseURL,
		viewport: { width: 800, height: 600 },
		deviceScaleFactor: 1,
		reducedMotion: "reduce",
		launchOptions: { args: ["--use-angle=swiftshader-webgl"] },
		trace: "retain-on-failure",
	},
	webServer: [
		{
			name: "server",
			command: "bun src/main.ts",
			cwd: "../server",
			env: { PORT: String(serverPort), SEED: "7" },
			wait: { stdout: /server listening on :\d+/ },
			reuseExistingServer: false,
		},
		{
			name: "web",
			command: `bun run vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
			cwd: "../web",
			env: { KORR_SERVER_PORT: String(serverPort) },
			url: baseURL,
			reuseExistingServer: false,
		},
	],
});
