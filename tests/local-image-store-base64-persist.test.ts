import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeImageAssetToLocal } from "@/lib/images/local-image-store";
import type { ImageAsset } from "@/lib/types";

// 1×1 transparent PNG, base64-encoded
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`;

const TASK_ID = `test-b64-persist-${Date.now()}`;

function buildTestAsset(): ImageAsset {
  return {
    taskId: TASK_ID,
    assetType: "cover",
    url: DATA_URI,
    reviewStatus: "pending",
    prompt: "unit test prompt",
    provider: "openai-compatible-image",
    generationMode: "prompt",
    images: [
      {
        id: `${TASK_ID}-img-0`,
        url: DATA_URI,
        prompt: "unit test prompt",
        alt: "test image",
        reviewStatus: "pending",
        provider: "openai-compatible-image",
        generationMode: "prompt",
        placement: { paragraphIndex: 0 },
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

describe("materializeImageAssetToLocal – base64 data URI", () => {
  let taskDir: string;

  beforeEach(() => {
    taskDir = path.join(process.cwd(), "public", "generated-images", TASK_ID);
  });

  afterEach(async () => {
    // Clean up written files
    try {
      await fs.rm(taskDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("replaces data URI in asset.url with a /generated-images/... public URL", async () => {
    const result = await materializeImageAssetToLocal(TASK_ID, buildTestAsset());

    expect(result.url).not.toMatch(/^data:/);
    expect(result.url).toMatch(/^\/generated-images\//);
  });

  it("replaces data URI in images[0].url with a /generated-images/... public URL", async () => {
    const result = await materializeImageAssetToLocal(TASK_ID, buildTestAsset());
    const img = result.images?.[0];

    expect(img?.url).not.toMatch(/^data:/);
    expect(img?.publicUrl).toMatch(/^\/generated-images\//);
  });

  it("writes a real PNG binary to disk (\\x89PNG magic bytes)", async () => {
    const result = await materializeImageAssetToLocal(TASK_ID, buildTestAsset());
    const localPath = result.images?.[0]?.localPath;

    expect(localPath).toBeTruthy();
    const buf = await fs.readFile(localPath as string);
    // PNG magic: 0x89 0x50 0x4E 0x47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // 'P'
    expect(buf[2]).toBe(0x4e); // 'N'
    expect(buf[3]).toBe(0x47); // 'G'
  });
});
