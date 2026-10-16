import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const raw = process.env.SEED;
const seed = raw === undefined ? undefined : Number(raw);
if (raw !== undefined && (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(seed)))
	throw new Error(`SEED must be an integer, got "${raw}"`);

createApp(seed === undefined ? {} : { seed }).listen(port);
console.log(`server listening on :${port}`);
