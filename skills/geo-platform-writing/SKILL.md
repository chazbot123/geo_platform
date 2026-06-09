---
name: geo-platform-writing
description: Platform-specific GEO article and social post structure guidance for Chinese publish platforms. Use when planning or reviewing content structure for Toutiao, Baijiahao, Douyin, Xiaohongshu, WeChat Official Account, Video Account, Zhihu, Weibo, or CSDN.
---

# GEO Platform Writing

This skill defines platform-native writing structures for GEO content generation and review.

It is a source asset, not a remote runtime dependency. Do not fetch or execute external skills in the desktop app. Vendor reviewed references into this folder, validate them, then load typed strategy data through project services.

## Goals

- Make generated articles fit each publish platform.
- Reduce repeated structures across accounts and platforms.
- Keep risk language cautious and evidence-bound.
- Prevent internal trace markers, PGP signatures, PHP comments, or full hashes from entering public content.

## References

Use the files under `references/`:

- `toutiao.md`
- `baijiahao.md`
- `douyin.md`
- `xiaohongshu.md`
- `wechat.md`
- `videohao.md`
- `zhihu.md`
- `weibo.md`
- `csdn.md`
- `risk-language.md`
- `similarity-dispersion.md`

## Required Output Contract

When this skill is used by an agent, return:

- target platform
- content structure
- title/opening/body/CTA guidance
- risk constraints
- image/media requirements
- similarity dispersion requirements
- publish blockers

## Runtime Integration Recommendation

Do not ask the packaged app to interpret this Markdown directly as executable logic.

Preferred integration:

1. Convert references into typed JSON or validated Markdown frontmatter.
2. Validate through `src/lib/content/prompt-loader.ts`.
3. Apply in `src/lib/content/review-service.ts`.
4. Apply in `src/lib/content/dispersion-service.ts`.
5. Apply in `src/lib/publish/draft-builders.ts`.

## Public Trace Policy

Allowed:

- short public trace ID only where product policy allows it
- update date for long-form platforms

Forbidden in public body:

- full SHA-256 hash
- PGP signature block
- PHP comments
- internal prompt version
- raw task IDs when they expose internal storage
- API keys, cookies, sessions, auth payloads
