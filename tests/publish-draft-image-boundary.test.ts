import { describe, expect, it } from "vitest";
import { resolvePublishImagePaths } from "@/lib/publish/publish-image-resolver";

describe("publish draft image boundary", () => {
  it("ignores failed or empty image sources when resolving publish paths", async () => {
    const paths = await resolvePublishImagePaths({
      taskId: "boundary-task",
      imageUrls: ["", "   "],
      localImagePaths: ["", "   "],
    });

    expect(paths).toEqual([]);
  });
});
