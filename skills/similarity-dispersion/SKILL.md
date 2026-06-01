---
name: similarity-dispersion
description: 针对同平台相似内容做离散。确保同一产品在同一平台发布多篇内容时，标题、开头、章节顺序、FAQ、CTA 有明显差异。
strategyVersion: geo-dispersion-1.0
---

# Similarity Dispersion

## When To Use

在生成新内容之前，如果同一产品在同一平台已有历史内容，调用本 skill 规划差异化角度。

## Inputs

- `taskId`：当前任务 ID
- `platform`：目标平台
- `historyDrafts`：同产品同平台的历史 ContentDraft 列表
- `productProfile`：产品资料

## Process

1. 从历史内容中提取 usedAngles、usedTitlePatterns、usedIntroPatterns
2. 从 `angle-library.json` 中选择一个未使用或低频次的角度
3. 输出 avoidPatterns（历史标题前缀、历史开头方式）
4. 将 newAngle 和 avoidPatterns 注入到主稿生成 prompt

## Output

```json
{
  "newAngle": { "angleId": "", "label": "", "description": "" },
  "avoidPatterns": { "titles": [], "intros": [] },
  "usedAngles": []
}
```

## Dispersion Levels

- **L1 轻度**：改标题、开头、CTA、语气（同一篇发不同平台）
- **L2 中度**：更换角度、调整章节顺序、重写50%段落、换FAQ（同平台多篇）
- **L3 深度**：重新定义选题、重新生成大纲、更换人设（批量内容）

## Angle Library

见 `angle-library.json`，包含 8 个预定义角度。
