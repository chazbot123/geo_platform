import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

describe("admin web assets", () => {
  test("uses relative static asset URLs so /admin/ deployments load CSS and JS", () => {
    const html = readFileSync(join(process.cwd(), "server/admin-web/src/index.html"), "utf8");

    expect(html).toContain('href="styles.css"');
    expect(html).toContain('src="app.js"');
    expect(html).not.toContain('href="/styles.css"');
    expect(html).not.toContain('src="/app.js"');
  });
});
