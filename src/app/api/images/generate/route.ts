import { NextResponse } from "next/server";
import { generateImageForTask } from "@/lib/images/service";
import { formatArticleGenerationError } from "@/lib/content/article-generation-service";

export async function POST(request: Request) {
  try {
    const { taskId, imageCount } = (await request.json()) as { taskId: string; imageCount?: number };
    const image = await generateImageForTask(taskId, imageCount);
    return NextResponse.json({ image });
  } catch (error) {
    return NextResponse.json({ error: formatArticleGenerationError(error) }, { status: 500 });
  }
}
