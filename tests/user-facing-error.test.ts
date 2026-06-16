import { afterEach, describe, expect, it, vi } from "vitest";
import { toUserFacingErrorMessage } from "@/lib/errors/user-facing";

const originalReleaseEndpoint = process.env.GEO_RELEASE_ENDPOINT;

afterEach(() => {
  if (originalReleaseEndpoint === undefined) {
    delete process.env.GEO_RELEASE_ENDPOINT;
  } else {
    process.env.GEO_RELEASE_ENDPOINT = originalReleaseEndpoint;
  }
  vi.unstubAllGlobals();
});

describe("toUserFacingErrorMessage", () => {
  it("localizes release manifest errors from update service", () => {
    expect(toUserFacingErrorMessage("Release manifest not found", "检查更新失败，请稍后重试。")).toBe(
      "未找到更新发布清单，请确认服务端已上传当前平台的安装包和版本信息。",
    );
  });

  it("localizes common English network and service errors", () => {
    expect(toUserFacingErrorMessage("fetch failed", "操作失败，请稍后重试。")).toBe("网络连接失败，请检查网络后重试。");
    expect(toUserFacingErrorMessage("Unauthorized", "操作失败，请稍后重试。")).toBe("认证失败，请重新登录或检查授权配置。");
    expect(toUserFacingErrorMessage("request timeout", "操作失败，请稍后重试。")).toBe("请求超时，请稍后重试。");
  });

  it("keeps already localized Chinese messages", () => {
    expect(toUserFacingErrorMessage("更新服务端点未配置", "检查更新失败，请稍后重试。")).toBe("更新服务端点未配置");
  });

  it("localizes upstream update route errors before returning them to UI", async () => {
    process.env.GEO_RELEASE_ENDPOINT = "https://updates.example.test/latest";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Release manifest not found" }), { status: 404 })),
    );

    const { GET } = await import("@/app/api/updates/latest/route");
    const response = await GET(new Request("http://localhost/api/updates/latest?version=0.1.0"));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("未找到更新发布清单，请确认服务端已上传当前平台的安装包和版本信息。");
  });
});
