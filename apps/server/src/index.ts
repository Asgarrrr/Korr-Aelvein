import { createApp } from "./app";

const PORT = Number(process.env["PORT"] ?? 3000);

const app = createApp().listen(PORT);

console.log(`server listening on http://localhost:${app.server?.port}`);

export type { App } from "./app";
