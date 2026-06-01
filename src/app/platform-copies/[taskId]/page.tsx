import { redirect } from "next/navigation";

export default async function PlatformCopiesPage({ params }: { params: { taskId: string } }) {
  redirect(`/reports/${params.taskId}`);
}
