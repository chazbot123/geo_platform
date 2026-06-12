# Debug Session: plan-save-refresh
- **Status**: [OPEN]
- **Issue**: 桌面端创建任务页保存计划后，没有自动刷新为已保存状态
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-plan-save-refresh.ndjson

## Reproduction Steps
1. 进入创建任务页。
2. 选择 GEO AI 平台、勾选可用发布平台账号、设置发布节奏。
3. 点击“保存计划”或“仅保存计划”。
4. 观察桌面端页面是否切换为已保存状态或“开始生成”。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 保存接口成功，但前端 `savePlan()` 后未正确写入 `prerequisites.savedPlan` | High | Low | Pending |
| B | `prerequisites.savedPlan` 已更新，但 `hasPlanChanges` 仍被判定为 true | High | Low | Rejected |
| C | Electron 页面在保存后发生中断或重载，导致最新状态未渲染 | Medium | Medium | Rejected |
| D | 保存后又被后续请求用旧数据覆盖回去了 | Medium | Medium | Rejected |
| E | 桌面端与 Web 端读取的不是同一份数据目录，导致页面看起来像“没有刷新” | High | Low | Confirmed |

## Log Evidence
- `3000` 侧保存接口成功，返回 `searchProvider=doubao`、`days=1`、`totalArticleCount=1`
- 桌面端 `3131/tasks/create` 页面快照显示仍是另一套计划：`searchProvider=tongyi`、`days=2`、多个平台已保存
- 工程目录任务文件：`data/tasks/customer-workbench-task.json`，内容为 `doubao / 1 天 / 1 篇`
- Electron 用户目录任务文件：`AppData/Roaming/geo-desktop/data/tasks/customer-workbench-task.json`，内容为 `tongyi / 2 天 / 8 篇`
- `electron/main.js` 证据：
  - `setupPersistencePaths()` 会设置 `process.env.GEO_DATA_DIR`
  - 但 `ensureDataDir()` 又无条件改回 `app.getPath("userData")/data`
  - 导致桌面端最终总是落到用户目录数据，而不是开发环境工程目录数据

## Verification Conclusion
- 根因已定位：桌面端与当前开发 Web 没有共用同一份 `data`，保存后的“未自动刷新”本质上是看到了另一份旧任务数据。
- 已修复：开发环境下 Electron 默认优先使用工程目录 `data`；若显式传入 `GEO_DATA_DIR`，也不再被后续逻辑覆盖。
- 待用户验证：重启后的桌面端创建任务页，是否与 `3000` 当前保存状态保持一致。
