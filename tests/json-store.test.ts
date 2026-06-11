import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonFile, writeJsonFile } from "@/lib/storage/json-store";

let tempDir: string | undefined;

afterEach(async () => {
  if (!tempDir) {
    return;
  }
  await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function makeTempFile(name: string) {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "geo-json-store-test-"));
  return path.join(tempDir, name);
}

describe("json-store", () => {
  it("recovers the first complete JSON object when trailing content is corrupted", async () => {
    const filePath = await makeTempFile("broken.json");
    await writeFile(
      filePath,
      `${JSON.stringify({ items: [{ id: "a" }], updatedAt: "2026-06-10T13:13:06.312Z" }, null, 2)}\n{"extra":true}\n`,
      "utf8",
    );

    const value = await readJsonFile<{ items: Array<{ id: string }>; updatedAt: string }>(filePath, {
      items: [],
      updatedAt: "",
    });

    expect(value.items).toHaveLength(1);
    expect(value.items[0]?.id).toBe("a");
    expect(value.updatedAt).toBe("2026-06-10T13:13:06.312Z");
  });

  it("writes valid JSON content", async () => {
    const filePath = await makeTempFile("roundtrip.json");

    await writeJsonFile(filePath, { ok: true, count: 2 });

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ ok: true, count: 2 });
  });
});
