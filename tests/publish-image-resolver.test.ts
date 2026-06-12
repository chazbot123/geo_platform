import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";

const testImageDir = path.join(process.cwd(), "public", "generated-images", "resolver-test-item");

afterEach(async () => {
  await rm(testImageDir, { recursive: true, force: true });
});

describe("publish image resolver", () => {
  it("falls back to generated image files for a content item", async () => {
    await mkdir(testImageDir, { recursive: true });
    await writeFile(path.join(testImageDir, "image-2.png"), "image2");
    await writeFile(path.join(testImageDir, "cover.png"), "cover");
    await writeFile(path.join(testImageDir, "image-1.png"), "image1");

    const paths = await resolvePublishImagePaths({ taskId: "resolver-test-item" });

    expect(paths.map((item) => path.basename(item))).toEqual(["cover.png", "image-1.png", "image-2.png"]);
  });
});
