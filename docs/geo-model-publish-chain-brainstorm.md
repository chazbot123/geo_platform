# GEO Model Publish Chain Brainstorm

Date: 2026-06-02

This document turns the current provider-to-platform idea into dispatchable work for multiple CLI agents. It is based on the current repository shape plus a fresh document check for model APIs and platform publishing routes.

## Ground Rules

- Do not treat a consumer chat app as a publish API.
- Separate three layers: model adapter, GEO content strategy, platform draft/publish route.
- A platform is `official_api` only when public docs show a supported write/publish API and permission path.
- If official API access is gated, missing, or unclear, use `electron_automation` or `manual_delivery`.
- Keep every route reviewable before submission. Do not auto-publish without a title/body/media validation gate.
- Never store or log API keys, OAuth tokens, cookies, browser profiles, or access tokens.

## Current Publish Matrix

| Search provider | Model adapter target | Primary GEO scenario | Platforms | Route priority |
| --- | --- | --- | --- | --- |
| doubao | `volcengine-ark` / `newapi-auto` | `doubao_plain_answer` | toutiao, baijiahao, douyin | toutiao first, then baijiahao, then douyin |
| tongyi | `dashscope-qwen` | `tongyi_structured_summary` | zhihu, weibo | zhihu article/answer draft, weibo summary thread |
| deepseek | `deepseek` | `deepseek_logic` | csdn, zhihu | CSDN technical article, Zhihu deep answer/article |
| yuanbao | `tencent-hunyuan` until Yuanbao exposes a stable API | `yuanbao_qa_chain` | videohao, wechat | WeChat official account first, videohao via assistant |

## External Document Findings

### Model APIs

- Doubao / Volcano Ark: official Chat API uses `POST https://ark.cn-beijing.volces.com/api/v3/chat/completions`; OpenAI SDK usage should set base URL to `https://ark.cn-beijing.volces.com/api/v3`.
- Qwen / DashScope: OpenAI-compatible calls use a compatible-mode base URL, e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1` or the international Qwen Cloud equivalent, then `/chat/completions`.
- DeepSeek: official OpenAI-compatible base URL is `https://api.deepseek.com`, with `/chat/completions`.
- Yuanbao: treat the consumer product as not directly automatable. For API-backed generation use Tencent Hunyuan OpenAI-compatible API: `https://api.hunyuan.cloud.tencent.com/v1/chat/completions`.

### Platform Publishing

- Toutiao: current reliable product route is Electron automation against the creator backend. Public ByteDance docs clearly describe Toutiao mini-program traffic and article/share entrances, but not a general public Headline account article publish API for this desktop product.
- Baijiahao: no stable public official article publish API was confirmed. Keep browser automation/manual delivery as the allowed route.
- Douyin: official OpenAPI supports video upload and video create with permission and user authorization. The route requires capability approval and `video.create.bind`; text/article-like content must be converted into video/image publish payloads or kept manual.
- Zhihu: official developer platform is focused on data/search for AI applications. Do not assume write/publish API. Use manual delivery or browser automation for creator-center publishing.
- Weibo: Weibo Open Platform has publish/share style APIs and historical article publish routes, but permissions and current availability must be re-audited before use. Browser/manual fallback remains required.
- CSDN: CSDN has a creator center, but no public stable write API was confirmed. Use manual delivery or browser automation.
- WeChat official account: official account draft and publish APIs are the strongest official route in this matrix, provided the account is eligible and access token/material upload/draft/publish steps are implemented.
- Videohao: public official write API coverage is limited. Use Video Account Assistant web workflow through Electron or manual delivery unless a documented and approved API route is obtained.

## Doubao Chain Stabilization

### Goal

Make `doubao -> content -> toutiao/baijiahao/douyin` reliable before expanding to other providers.

### Stage Flow

1. Model probe
   - Normalize provider as `volcengine-ark` or `doubao-ark`.
   - Accept base inputs: root domain, `/api/v3`, `/api/v3/chat/completions`.
   - Resolve all Ark chat calls to `https://ark.cn-beijing.volces.com/api/v3/chat/completions`.
   - Preserve `newapi-auto` probing and mock fallback.

2. GEO question generation
   - Generate user-real AI search questions for Doubao-style plain answers.
   - Require coverage over intent, scenario, commercial stage, and risk boundary.
   - Reject generic marketing topics.

3. Content strategy
   - Use `doubao_plain_answer` prompt assets.
   - Produce one authority-style article draft plus FAQ and evidence notes.
   - Run content review before platform drafts.

4. Toutiao draft
   - Normalize title length.
   - Keep body scannable, evidence-first, and local/product-specific.
   - Route through Electron automation first; manual delivery remains fallback.

5. Baijiahao draft
   - Convert to Baijiahao-compatible title/body/tags.
   - Browser automation only after login/session validation.
   - Do not claim official API status.

6. Douyin draft
   - Convert article intent into short video script, caption, tags, and cover notes.
   - Official API path is only valid when video media exists and `video.create.bind` permission plus user authorization are available.
   - Otherwise use creator web workflow/manual delivery.

### Doubao Success Criteria

- Ark endpoint normalization is tested.
- `provider-platform-matrix` labels are readable and correct.
- Draft generation uses one shared builder pipeline.
- Publish jobs cannot run without title/body/media requirements for the target platform.
- Toutiao, Baijiahao, and Douyin each expose route status: `official_api_unavailable`, `electron_ready`, `manual_required`, or `official_api_ready`.

## Expansion Chains

### Tongyi / Qwen -> Zhihu + Weibo

Purpose: structured summary and expertise positioning.

Tasks:

- Add `dashscope-qwen` provider profile with compatible-mode endpoint tests.
- Extend scenario prompts for `tongyi_structured_summary`.
- Zhihu draft type: answer/article, with question framing, references, and anti-marketing tone.
- Weibo draft type: short post, long article candidate, thread plan, and hashtags.
- Audit Weibo API availability before official integration; otherwise use manual/browser route.
- Keep Zhihu as browser/manual unless a documented write API is approved.

### DeepSeek -> CSDN + Zhihu

Purpose: technical credibility, reasoning-heavy comparison, implementation detail.

Tasks:

- Update DeepSeek model defaults away from soon-to-be-deprecated aliases when needed.
- Generate logic-first article outlines, code snippets, checklists, and caveats.
- CSDN draft type: technical blog with headings, code blocks, diagrams placeholder, original/translation metadata.
- Zhihu draft type: deep answer with conclusion first, reasoning chain hidden in prose, and explicit limitations.
- Do not use hidden/internal CSDN or Zhihu endpoints.

### Yuanbao / Hunyuan -> Videohao + WeChat

Purpose: Tencent ecosystem distribution and Q&A retention.

Tasks:

- Use Tencent Hunyuan as the API-backed model adapter unless Yuanbao exposes an official API.
- WeChat official account path: upload material -> add draft -> submit publish -> poll status.
- Videohao path: video script + caption + cover + tags -> Video Account Assistant web flow.
- Add a shared article-to-video-script transformer for Videohao and Douyin.
- Require compliance review for WeChat external links, QR code language, medical/legal/financial claims, and AIGC disclosure where applicable.

## Multi-CLI Dispatch Plan

### Controller

Read:

- `AGENTS.md`
- `docs/geo-model-publish-chain-brainstorm.md`
- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/types.ts`

Responsibilities:

- Keep file ownership non-overlapping.
- Assign one provider chain at a time.
- Require every worker to report changed files, checks run, source assumptions, and unresolved platform permission risks.

### Worker A: Doubao Model Adapter

Files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/config/service.ts`
- `scripts/verify-model-endpoints.ts`

Prompt:

```text
Stabilize the Doubao/Volcano Ark model adapter only. Normalize Ark base URLs so root domain, /api/v3, and /api/v3/chat/completions all resolve to the official /api/v3/chat/completions endpoint. Preserve newapi-auto and mock fallback. Add or update endpoint verification tests. Do not edit publishing, UI, or Electron files.
```

### Worker B: Doubao Publish Chain

Files:

- `src/lib/publish/provider-platform-matrix.ts`
- `src/lib/publish/platforms.ts`
- `src/lib/publish/draft-builders.ts`
- `src/lib/publish/workbench-service.ts`
- `src/lib/publish/publish-orchestrator.ts`
- `src/lib/publish/jobs-service.ts`

Prompt:

```text
Stabilize the Doubao publish chain for toutiao, baijiahao, and douyin. Make route availability explicit per platform, use one shared draft builder, and ensure jobs cannot run without required draft fields. Do not edit model adapter or Electron DOM scripts.
```

### Worker C: Electron Automation

Files:

- `electron/main.js`
- `electron/publish-automation/toutiao.js`
- `electron/publish-automation/baijiahao.js`
- `electron/publish-automation/douyin.js`
- `electron/publish-automation/dom-helpers.js`
- `src/lib/publish/platform-publishers/electron-browser-publisher.ts`

Prompt:

```text
Standardize browser publishing automation for toutiao, baijiahao, and douyin. Extract reusable DOM helpers, name stages consistently, return structured success/failure objects, and preserve manual fallback. Do not change model adapter or content strategy.
```

### Worker D: Qwen + DeepSeek Expansion

Files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/integrations/stage1/client.ts`
- `src/lib/integrations/content/client.ts`
- `skills/`
- `src/lib/content/prompt-loader.ts`

Prompt:

```text
Add strategy support for Tongyi/Qwen and DeepSeek GEO chains. Qwen maps to zhihu/weibo; DeepSeek maps to csdn/zhihu. Keep publishing as draft/manual unless a documented official write API is available. Do not edit Electron automation.
```

### Worker E: Yuanbao + WeChat/Videohao

Files:

- `src/lib/integrations/openai-compatible.ts`
- `src/lib/integrations/content/client.ts`
- `src/lib/publish/platforms.ts`
- `src/lib/publish/draft-builders.ts`
- `src/lib/publish/provider-platform-matrix.ts`

Prompt:

```text
Stabilize the Yuanbao chain by using Tencent Hunyuan as the API-backed provider profile unless a Yuanbao API exists. Build WeChat official account draft/publish capability as the first official API route, and keep Videohao as browser/manual until official write API access is documented. Do not touch Doubao Electron scripts.
```

### Worker F: Workflow UI

Files:

- `src/app/**`
- `src/components/**`
- `src/hooks/use-task-draft-store.ts`

Prompt:

```text
Expose model probe, content review, platform draft, route availability, and publish job status in the UI. Keep route handlers thin. Do not change service internals except response shape typing needed for display.
```

## Verification

Run after focused changes:

```powershell
npm run check
npm run build:web
```

For docs-only changes, `git status --short --branch` is enough unless implementation files were touched.

## Source Links Checked

- Volcano Ark Chat API: https://www.volcengine.com/docs/82379/1362913
- Doubao text generation examples: https://www.volcengine.com/docs/82379/1399009
- Douyin video upload: https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/upload-video
- Douyin video create: https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create
- Toutiao mini-program traffic / account access: https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/flow-entrance/toutiao/toutiao-account-access/toutiao-account-desc
- Toutiao publish/share trigger notes: https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/open-interface/video-camera/request-method
- Qwen OpenAI compatibility: https://docs.qwencloud.com/api-reference/toolkitframework/openai-compatible/overview
- Alibaba Cloud Qwen Chat API via OpenAI format: https://www.alibabacloud.com/help/zh/model-studio/qwen-api-via-openai-chat-completions
- DeepSeek first API call: https://api-docs.deepseek.com/
- DeepSeek chat completion: https://api-docs.deepseek.com/api/create-chat-completion
- Tencent Hunyuan OpenAI-compatible API: https://cloud.tencent.com/document/product/1729/111007
- Zhihu developer platform: https://developer.zhihu.com/
- Zhihu creator manual: https://www.zhihu.com/knowledge-plan/manual
- Weibo Open Platform account/API pointer: https://www.weibo.com/openapi
- CSDN creator center: https://mp.csdn.net/
- CSDN official blog/help categories: https://blog.csdn.net/blogdevteam/category_9176652.html
- WeChat official account draft API: https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html
- WeChat official account publish API: https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html
- Video Account Assistant entry: https://channels.weixin.qq.com/
