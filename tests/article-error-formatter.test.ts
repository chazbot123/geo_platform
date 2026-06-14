import { describe, expect, it } from "vitest";
import { formatArticleGenerationError } from "@/lib/content/article-generation-service";

describe("formatArticleGenerationError", () => {
  it("returns 429 rate-limit message for HTTP_429@ prefix", () => {
    const err = new Error("HTTP_429@https://api.52hertz-palpitate.cn/v1/chat/completions");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("限流");
    expect(msg).toContain("429");
  });

  it("returns 429 rate-limit message for RATE_LIMIT in message", () => {
    const err = new Error("SOME_RATE_LIMIT_ERROR");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("限流");
  });

  it("returns auth failure message for HTTP_401@", () => {
    const err = new Error("HTTP_401@https://api.example.com/v1/chat");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("认证失败");
  });

  it("returns auth failure message for HTTP_403@", () => {
    const err = new Error("HTTP_403@https://api.example.com/v1/chat");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("认证失败");
  });

  it("returns server unavailable message for HTTP_5xx@", () => {
    const err = new Error("HTTP_503@https://api.example.com/v1/chat");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("暂时不可用");
  });

  it("returns timeout message for REQUEST_TIMEOUT", () => {
    const err = new Error("REQUEST_TIMEOUT");
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("超时");
  });

  it("returns timeout message for AbortError", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    const msg = formatArticleGenerationError(err);
    expect(msg).toContain("超时");
  });

  it("passes through unknown error messages as-is", () => {
    const err = new Error("ARTICLE_STAGE_EMPTY_BODY");
    const msg = formatArticleGenerationError(err);
    expect(msg).toBe("ARTICLE_STAGE_EMPTY_BODY");
  });

  it("returns fallback message for non-Error values", () => {
    const msg = formatArticleGenerationError("something went wrong");
    expect(msg).toBe("文章生成失败。");
  });
});
