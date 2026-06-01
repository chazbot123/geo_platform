---
name: platform-article-structure
description: 根据发布平台改写文章结构。不同平台有不同标题长度、段落风格、CTA 风格和约束。
strategyVersion: geo-platform-1.0
---

# Platform Article Structure

## When To Use

在主稿生成时，根据用户选择的目标平台，将平台策略注入到生成 prompt 中，使 LLM 直接输出符合该平台原生表达习惯的内容。

## Inputs

- `platform`：目标平台枚举 `toutiao | wechat | blog | xiaohongshu | douyin`
- `productProfile`：产品资料
- `selectedQuestions`：已确认用户提问句
- `aiScenario`：AI 场景

## Process

1. 加载 `platform-strategies/{platform}.json`
2. 把策略 JSON 渲染为自然语言片段注入到主稿 prompt
3. LLM 按平台策略输出符合该平台结构的内容
4. 质检 skill 检查标题长度、风险词、公开标记是否合规

## Output

ContentDraft 的 title/summary/reportSections 已按平台策略组织。

## Strategy Files

- `platform-strategies/toutiao.json` — 钩子型信息流，标题≤30字
- `platform-strategies/wechat.json` — 深度逻辑型，适合完整阅读
- `platform-strategies/blog.json` — SEO/GEO 型，含 FAQ 和元信息
- `platform-strategies/xiaohongshu.json` — 场景种草/避坑，清单化
- `platform-strategies/douyin.json` — 口播脚本型，前 3 秒钩子
