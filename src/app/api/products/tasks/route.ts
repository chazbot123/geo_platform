import { NextResponse } from "next/server";
import { createTask } from "@/lib/tasks/service";
import type { TaskCreateInput } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as TaskCreateInput;
    if (!input.searchProvider) {
      return NextResponse.json({ error: "请选择检索平台。" }, { status: 400 });
    }

    if (!input.productName || !input.category || !input.sellingPoints || !input.targetAudience || !input.scenarios || !input.brandTone) {
      return NextResponse.json({ error: "缺少必填字段。" }, { status: 400 });
    }

    if (input.city && !input.province) {
      return NextResponse.json({ error: "选择城市前请先选择省份。" }, { status: 400 });
    }

    if (input.district && (!input.province || !input.city)) {
      return NextResponse.json({ error: "选择城区前请先选择省份和城市。" }, { status: 400 });
    }

    const payload = await createTask(input);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建任务失败。" }, { status: 500 });
  }
}
