import { create } from "zustand";
import type { FolderImportSuggestion, TaskCreateInput } from "@/lib/types";

interface TaskDraftState {
  draft: TaskCreateInput;
  setField: <K extends keyof TaskCreateInput>(field: K, value: TaskCreateInput[K]) => void;
  fillDraft: (patch: Partial<TaskCreateInput>) => void;
  applyImportSuggestions: (suggestions: FolderImportSuggestion[]) => void;
  reset: () => void;
}

const initialDraft: TaskCreateInput = {
  productName: "",
  category: "",
  sellingPoints: "",
  targetAudience: "",
  priceRange: "",
  scenarios: "",
  brandTone: "",
  competitorName: "",
  competitorKeywords: "",
  competitorLink: "",
  restrictedWords: "",
  complianceNotes: "",
  productImagePath: "",
  brandImagePath: "",
  documentPath: "",
  scheduledAt: "",
};

export const useTaskDraftStore = create<TaskDraftState>((set) => ({
  draft: initialDraft,
  setField: (field, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        [field]: value,
      },
    })),
  fillDraft: (patch) =>
    set((state) => ({
      draft: {
        ...state.draft,
        ...patch,
      },
    })),
  applyImportSuggestions: (suggestions) =>
    set((state) => ({
      draft: suggestions.reduce<TaskCreateInput>(
        (nextDraft, suggestion) => ({
          ...nextDraft,
          [suggestion.field]: suggestion.value,
        }),
        state.draft,
      ),
    })),
  reset: () => set({ draft: initialDraft }),
}));
