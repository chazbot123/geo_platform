# Risk Language Reference

Forbidden public patterns:

- absolute guarantees
- unverifiable rankings
- fake official endorsements
- invented cases
- fabricated test data
- medical/legal/financial certainty without qualification
- internal trace markers
- full SHA-256 hashes
- PGP signature blocks
- PHP comments
- prompt versions
- API keys, cookies, tokens, auth payloads

Preferred patterns:

- "需要结合具体情况判断"
- "以下是常见判断标准"
- "建议核验资质/合同/现场情况"
- "如果场景不同，结论可能变化"
- "本文基于已提供资料和可核验信息整理"

Review result should classify:

- blocking: cannot publish before rewrite
- warning: can publish only after manual confirmation or rewrite
- passed: safe for publish preparation
