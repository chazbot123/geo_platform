---
name: content-signature-marker
description: 为内容生成合适的可信标记（时间戳、内容编号、免责声明等），区分公开展示和内部保存。
strategyVersion: geo-marker-1.0
---

# Content Signature Marker

## When To Use

在内容生成完成后，根据目标平台决定哪些追踪标记可以公开展示、哪些只能内部保存。

## Inputs

- `platform`：目标平台
- `taskId`：任务编号
- `promptVersion`：prompt 版本
- `generatedAt`：生成时间

## Process

1. 加载 `exposure-policy.json`
2. 根据平台查找对应的暴露策略
3. 生成公开标记（如有）和内部标记

## Output

```json
{
  "public": { "footer": "", "disclaimer": "" },
  "internal": { "traceId": "", "promptVersion": "", "generatedAt": "" },
  "exposurePolicy": { "showTimestamp": false, "showShortTraceId": false }
}
```

## Red Lines

- 第三方平台正文不得出现完整 hash、PGP 签名块、PHP 注释
- 可信标记只能用于追踪和说明，不能伪造权威
