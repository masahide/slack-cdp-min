export type SummaryEditorDraft = {
  date: string;
  content: string;
  updatedAt?: string;
};

export type SummaryWorkspaceEvents = {
  modelchange: { model: string };
  promptsubmit: { prompt: string; model: string };
  draftinput: { content: string };
  draftsave: { content: string };
  draftcreate: { date: string };
};

export type SummaryUpdate = {
  mode: "replace" | "append" | "none";
  content: string;
};

export type SummarySuggestionPayload = {
  summaryUpdate: SummaryUpdate;
  assistantMessage: string;
  reasoning: string | null;
  responseId: string | null;
};
