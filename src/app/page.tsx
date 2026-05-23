import { AppShell } from "@/components/layout/app-shell";
import { TaskCreator } from "@/components/task/task-creator";

export default function HomePage() {
  return (
    <AppShell title="创建 GEO 任务" description="录入产品资料、竞品信息、合规限制和本地素材路径，启动桌面版 GEO 最小闭环流程。">
      <TaskCreator />
    </AppShell>
  );
}