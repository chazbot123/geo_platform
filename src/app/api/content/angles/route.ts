import { NextResponse } from "next/server";
import { loadAngleLibrary } from "@/lib/content/prompt-loader";

export async function GET() {
  try {
    const library = await loadAngleLibrary();
    return NextResponse.json({ angles: library.angles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载角度库失败", angles: [] },
      { status: 500 },
    );
  }
}
