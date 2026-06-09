import { NextResponse } from "next/server";
import { listPublishAuditLog } from "@/lib/publish/publish-queue-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "200");
    return NextResponse.json({ items: await listPublishAuditLog(Number.isFinite(limit) ? limit : 200) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read publish audit log." },
      { status: 500 },
    );
  }
}
