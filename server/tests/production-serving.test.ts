import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../src/app.js";

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

async function startProductionApp() {
  const directory = await mkdtemp(join(tmpdir(), "bela-client-build-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Bela test frontend</title>");
  await writeFile(join(directory, "assets", "app.js"), "window.belaReady = true;");
  const { httpServer } = createApplication({ production: true, clientDistPath: directory });
  servers.push(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server failed to bind.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("production frontend serving", () => {
  it("serves built assets and the SPA entry point on direct navigation and refresh routes", async () => {
    const origin = await startProductionApp();
    const root = await fetch(`${origin}/`);
    const route = await fetch(`${origin}/private/room/ABC123`);
    const asset = await fetch(`${origin}/assets/app.js`);

    expect(root.status).toBe(200);
    expect(await root.text()).toContain("Bela test frontend");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("Bela test frontend");
    expect(await asset.text()).toContain("belaReady");
  });

  it("keeps development APIs unavailable and does not send API misses to the SPA", async () => {
    const origin = await startProductionApp();
    const devApi = await fetch(`${origin}/api/dev/match`);
    const missingApi = await fetch(`${origin}/api/not-real`);
    const health = await fetch(`${origin}/health`);

    expect(devApi.status).toBe(404);
    expect(missingApi.status).toBe(404);
    expect((await missingApi.json()).error).toBe("API endpoint not found.");
    expect(await health.json()).toEqual({ status: "ok" });
  });
});
