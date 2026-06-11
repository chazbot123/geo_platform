# 内容池黑盒生成多任务分发方案

日期：2026-06-10

## 结论

本轮改造必须按“单领域单 worker”拆分，避免多人同时改同一批文件。

推荐拆成 5 个 worker：

- Worker A：任务页与流程壳
- Worker B：内容池前端与详情
- Worker C：内容生成后端与状态模型
- Worker D：发布衔接与任务状态
- Worker E：测试与回归验证

## 总原则

- 用户可见目标只有 3 件事：保存计划、开始生成、查看文章结果
- “样文、改写、降重、复检、离散”全部转入后端黑盒
- 前端改造必须使用 `frontend-design` 约束
- 后端必须把“读取内容池”和“启动生成”解耦
- 多 worker 不同时修改同一文件集

## Worker A：任务页与流程壳

### 目标

- 在创建任务页补齐 `保存计划 -> 开始生成 -> 跳内容池`
- 调整全局流程文案，统一成黑盒结果导向

### 负责文件

- `src/components/tasks/task-planning-workbench.tsx`
- `src/app/tasks/create/page.tsx`
- `src/components/layout/app-shell.tsx`
- `src/lib/workflow/status-service.ts`
- `src/app/api/workflow/status/route.ts`

### 交付内容

- 保存成功后不再直接跳内容池
- 新增 `开始生成` 主按钮
- “内容池”导航语义改为结果中心
- 流程状态文案不再暴露工序术语

### 依赖

- 依赖 Worker C 提供生成启动状态字段

### 风险

- 当前任务页有总篇数计算偏差，改按钮逻辑时要一起修

## Worker B：内容池前端与详情

### 目标

- 重做内容池首页为“任务总览 + 列表”
- 新增文章详情承载正文

### 负责文件

- `src/components/content/content-pool.tsx`
- `src/app/content-pool/page.tsx`
- 新增 `src/components/content/content-item-detail.tsx` 或同级组件
- 可选新增 `src/app/content-pool/[itemId]/page.tsx`

### 交付内容

- 顶部总览卡：总篇数、已生成、生成中、失败、待发布
- 列表只展示基础信息
- 详情页/抽屉显示正文、图片、风险、发布时间
- 生成中条目展示动态状态文案
- 历史任务入口与本次任务视图切换

### 依赖

- 依赖 Worker C 的文章级状态接口
- 依赖 Worker D 的发布状态字段

### 风险

- 当前内容池组件绑定了“自动改写/确认/降重”操作，要完整收口

## Worker C：内容生成后端与状态模型

### 目标

- 建立独立的“开始生成”后端入口
- 建立任务级和文章级生成状态
- 把内容池读取和生成动作解耦

### 负责文件

- `src/lib/content/service.ts`
- `src/lib/tasks/service.ts`
- `src/lib/types.ts`
- `src/app/api/tasks/plan/route.ts`
- 新增 `src/app/api/content/generation/start/route.ts`
- 新增 `src/app/api/content/generation/status/route.ts`

### 交付内容

- 计划保存只保存，不再隐式生成
- 新增开始生成接口
- 文章级记录生成状态
- 对外统一映射为简化状态
- 内容池 GET 只读，不再带隐式生成副作用

### 依赖

- 无前置依赖，可先开工

### 风险

- 当前批量文章仍偏模板拼文，至少先把状态链路跑通
- 多任务并行前要显式引入 `taskId` 约束

## Worker D：发布衔接与任务状态

### 目标

- 确保文章生成完成后能平滑进入现有发布链路
- 保证新状态不破坏发布执行

### 负责文件

- `src/lib/publish/jobs-service.ts`
- `src/lib/publish/execution-service.ts`
- `src/app/api/publish/execution/route.ts`
- `src/components/publish/publish-execution-workbench.tsx`

### 交付内容

- 只允许可发布文章进入发布队列
- 任务级总量与发布进度联动
- 内容池详情里能看到发布状态
- 保持现有断点续发可用

### 依赖

- 依赖 Worker C 输出的文章外显状态

### 风险

- 发布链路历史兼容多，改状态映射时要避免旧数据失效

## Worker E：测试与回归验证

### 目标

- 为新流程补最小但有效的回归测试
- 验证任务保存、开始生成、内容池展示、发布衔接

### 负责文件

- `tests/**`
- 可能新增 API 测试和服务层单测

### 交付内容

- 任务保存后不自动生成测试
- 开始生成后生成状态推进测试
- 内容池列表只展示结果字段测试
- 文章详情读取测试
- 发布衔接状态映射测试

### 依赖

- 依赖 Worker A、B、C、D 基本落地后再集中补齐

### 风险

- 不要写表面化 UI 测试，优先覆盖服务层和 API 约束

## 执行顺序

### 第一批并行

- Worker C：先做状态模型与接口
- Worker A：同步改任务页按钮与流程文案

### 第二批并行

- Worker B：在 Worker C 接口基础上重做内容池
- Worker D：同步整理发布衔接

### 第三批

- Worker E：统一补测试与回归

## 文件边界

禁止多人同时改这些文件：

- `src/lib/content/service.ts`
- `src/lib/tasks/service.ts`
- `src/lib/types.ts`
- `src/components/tasks/task-planning-workbench.tsx`
- `src/components/content/content-pool.tsx`
- `src/lib/publish/execution-service.ts`

若必须跨域改动，先由主 worker 合并接口约定，再分别提交。

## 接口约定

### Worker A 依赖 Worker C

- 需要拿到：
  - `task` 是否已保存
  - `task` 是否已开始生成
  - `task` 当前生成进度

### Worker B 依赖 Worker C

- 需要拿到文章列表字段：
  - `id`
  - `title`
  - `summary`
  - `displayStatus`
  - `stageMessage`
  - `platform`
  - `accountId`
  - `keyword`
  - `updatedAt`

### Worker D 依赖 Worker C

- 需要拿到：
  - `ready` / `pending_publish` / `publishing` / `published` 映射规则

## 每个 worker 的验收口径

### Worker A

- 任务页出现 `开始生成`
- 保存后不自动跳内容池

### Worker B

- 内容池首页不再铺正文
- 详情可看正文

### Worker C

- 存在显式“开始生成”接口
- 内容池 GET 不再隐式生成

### Worker D

- 已生成文章可平滑进入发布链路
- 发布中断恢复不受影响

### Worker E

- `npm run check` 通过
- 新流程关键测试通过

## 主 worker 汇总要求

主 worker 最终汇总时必须输出：

- 变更文件
- 新增接口
- 测试结果
- 未解决风险
- 是否影响其他 worker
- 是否运行 `npm run build:web`

## 当前建议

如果只开第一轮落地，优先顺序如下：

1. Worker C
2. Worker A
3. Worker B
4. Worker D
5. Worker E

原因：

- 不先把显式生成入口和状态模型立起来，前端只能继续做假交互
- 不先拆开“保存计划”和“开始生成”，产品主流程永远不成立
