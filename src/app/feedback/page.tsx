import { AppShell } from "@/components/layout/app-shell";
import { FeedbackBox } from "@/components/settings/feedback-box";

export default function FeedbackPage() {
  return (
    <AppShell title="意见反馈" description="提交使用问题、发布异常和改进建议。">
      <FeedbackBox />
    </AppShell>
  );
}
