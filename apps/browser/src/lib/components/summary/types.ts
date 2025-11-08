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
};
