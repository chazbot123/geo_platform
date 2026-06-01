import { AppShell } from "@/components/layout/app-shell";
import { TaskCreator } from "@/components/task/task-creator";

export default function HomePage() {
  return (
    <AppShell title="创建 GEO 任务" description="先选择检索平台，再录入产品资料与素材路径，生成 10 条 AI 用户提问句，并进入第二阶段权威报告生成流程。">
      <TaskCreator />
    </AppShell>
  );
}
