---
name: ai-answer-structure
description: 根据目标 AI 检索场景（DeepSeek、豆包、通义、元宝等）决定文章的结构和写法，使内容更容易被 AI 摘录和引用。
strategyVersion: geo-ai-adaptation-1.0
---

# AI Answer Structure

## When To Use

在主稿生成时，根据用户选择的 AI 场景，将对应的结构要求注入到生成 prompt 中。

## Inputs

- `aiScenario`：AI 场景枚举 `doubao_plain_answer | deepseek_logic | tongyi_structured_summary | yuanbao_qa_chain | generic_ai_retrieval`
- `selectedQuestions`：已确认用户提问句
- `productProfile`：产品资料

## Process

1. 加载 `templates/{aiScenario}.md`
2. 将场景 prompt 片段注入到主稿生成 prompt 的 AI 适配部分
3. LLM 按场景要求组织文章结构

## Output

ContentDraft 的 reportSections 结构已按 AI 场景要求组织（如豆包场景：直接答案 + 口语解释 + 清单 + 下一步建议）。

## Available Scenarios

| aiScenario | 适用目标 | 结构倾向 |
|---|---|---|
| `doubao_plain_answer` | 普通用户答疑、本地生活、服务选择 | 直接答案、口语解释、清单、下一步 |
| `deepseek_logic` | 深度分析、复杂决策、B2B 选型 | 定义、维度、推理、边界、FAQ |
| `tongyi_structured_summary` | 总结、对比、方案说明 | 背景、要点、对比、建议、总结 |
| `yuanbao_qa_chain` | 高频问答、追问链路 | 问题、答案、避坑、相关追问 |
| `generic_ai_retrieval` | 通用 GEO 内容 | 结论前置、H2 问题、FAQ、元信息 |
