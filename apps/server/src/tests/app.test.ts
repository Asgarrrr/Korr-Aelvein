import { describe, expect, test } from "bun:test";
import { createApp } from "../app";

describe("createApp", () => {
  test("GET /health returns 200 with { ok: true }", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/health", { method: "GET" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  test("GET /unknown returns 404", async () => {
    const app = createApp();
    const response = await app.handle(
      new Request("http://localhost/unknown", { method: "GET" }),
    );
    expect(response.status).toBe(404);
  });

  test("createApp returns a fresh instance per call (no shared state)", () => {
    const a = createApp();
    const b = createApp();
    expect(a).not.toBe(b);
  });
});
