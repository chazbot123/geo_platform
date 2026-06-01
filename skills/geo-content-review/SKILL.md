---
name: geo-content-review
description: 生成后自动检查内容是否满足平台结构、合规、AI 摘录和相似性离散要求。
strategyVersion: geo-review-1.0
---

# GEO Content Review

## When To Use

在内容生成完成后、发布之前，调用本 skill 做规则级质检。

## Inputs

- `draft`：生成的 ContentDraft
- `platform`：目标平台
- `aiScenario`：AI 场景
- `selectedQuestions`：必答提问句列表
- `historyDrafts`：历史内容（可选，用于相似性检查）

## Process

1. 规则质检：
   - 风险词扫描（`risk-words.json`）
   - 标题长度检查（对照平台策略 `title.maxLength`）
   - 必答问题覆盖率（selectedQuestions 是否在 reportSections 中出现）
   - 公开标记检查（不该出现的 hash/PGP/PHP 是否泄露到正文）
2. 输出 blockingIssues（必须修复）和 warnings（建议修复）

## Output

```json
{
  "passed": true,
  "blockingIssues": [],
  "warnings": [],
  "scores": {
    "platformFit": 0,
    "complianceFit": 0,
    "questionCoverage": 0
  }
}
```

## Risk Words

见 `risk-words.json`，分为 blockingWords（必须修复）和 warningWords（建议修复）。
