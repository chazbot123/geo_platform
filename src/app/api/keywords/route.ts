import { NextResponse } from "next/server";
import { getCustomerKeywordWorkbenchData } from "@/lib/keywords/service";

export async function GET() {
  try {
    return NextResponse.json(await getCustomerKeywordWorkbenchData());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取客户关键词失败。" }, { status: 500 });
  }
}
