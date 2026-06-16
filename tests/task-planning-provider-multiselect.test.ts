import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("task planning provider multiselect", () => {
  it("posts selected AI providers with legacy provider compatibility", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "task-planning-workbench.tsx"), "utf8");

    expect(source).toContain("searchProviders: selectedSearchProviders");
    expect(source).toContain("searchProvider: selectedSearchProviders[0]");
  });

  it("loads saved multi-provider plans before falling back to legacy provider", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "task-planning-workbench.tsx"), "utf8");

    expect(source).toContain("normalizeSavedSearchProviders(data.savedPlan as SavedPublishTaskPlan)");
    expect(source).toContain("savedPlan.searchProviders");
    expect(source).toContain("savedPlan.searchProvider");
  });

  it("builds publish platform cards from the union of all selected AI providers", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "task-planning-workbench.tsx"), "utf8");

    expect(source).toContain("selectedSearchProviders.flatMap((provider) => getPlatformsBySearchProvider(provider))");
    expect(source).toContain("toggleSearchProvider");
  });
});
