import { defineConfig } from "vite";

const serverPort = process.env.KORR_SERVER_PORT ?? 3000;

export default defineConfig({
	server: {
		proxy: { "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true } },
	},
});
