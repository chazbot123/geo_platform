import { NextResponse } from "next/server";
import { confirmKeywords, getCustomerKeywordWorkbenchData, saveCustomerKeywordSelection } from "@/lib/keywords/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId?: string;
      selectedKeywords?: string[];
      selectedIds?: string[];
      mode?: "customer";
    };

    if (!body.taskId || body.mode === "customer") {
      if (!Array.isArray(body.selectedIds)) {
        return NextResponse.json({ error: "缺少选中的客户问题。" }, { status: 400 });
      }
      const keywordSet = await saveCustomerKeywordSelection(body.selectedIds);
      const workbenchData = await getCustomerKeywordWorkbenchData();
      return NextResponse.json({ ...workbenchData, keywordSet });
    }

    if (!Array.isArray(body.selectedKeywords) || !body.selectedKeywords.length) {
      return NextResponse.json({ error: "缺少任务 ID 或选中的关键词列表。" }, { status: 400 });
    }
    const theme = await confirmKeywords(body.taskId, body.selectedKeywords);
    return NextResponse.json({ theme });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认关键词失败。" }, { status: 400 });
  }
}
