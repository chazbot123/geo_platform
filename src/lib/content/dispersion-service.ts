import { loadAngleLibrary } from "@/lib/content/prompt-loader";
import type { ContentDraft } from "@/lib/types";

export interface DispersionPlan {
  newAngle: { angleId: string; label: string; description: string };
  avoidPatterns: { titles: string[]; intros: string[] };
  usedAngles: string[];
}

export async function planDispersion(
  platform: string,
  historyDrafts: ContentDraft[],
): Promise<DispersionPlan> {
  const library = await loadAngleLibrary();
  const usedAngles = historyDrafts
    .map((d) => d.contentAngle)
    .filter((a): a is string => Boolean(a));

  const platformAngles = library.angles.filter(
    (a) => a.applicablePlatforms.includes(platform) || a.applicablePlatforms.length === 0,
  );

  const available = platformAngles.filter((a) => !usedAngles.includes(a.angleId));
  const chosen = available[0] ?? platformAngles[0] ?? library.angles[0];

  const avoidTitles = historyDrafts
    .map((d) => d.title?.slice(0, 12))
    .filter((t): t is string => Boolean(t));

  const avoidIntros = historyDrafts
    .map((d) => (d.reportIntroduction ?? d.summary ?? "").slice(0, 30))
    .filter(Boolean);

  return {
    newAngle: chosen
      ? { angleId: chosen.angleId, label: chosen.label, description: chosen.description }
      : { angleId: "selection_criteria", label: "选择标准", description: "围绕如何判断、如何选择展开" },
    avoidPatterns: { titles: avoidTitles, intros: avoidIntros },
    usedAngles,
  };
}
