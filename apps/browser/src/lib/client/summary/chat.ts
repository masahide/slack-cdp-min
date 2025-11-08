export type SummaryChatRequest = {
  model: string;
  prompt: string;
  content: string;
};

export type SummaryChatResponse = {
  delta: string;
};

export async function requestSuggestion(
  input: SummaryChatRequest,
  fetchImpl: typeof fetch = fetch
): Promise<SummaryChatResponse> {
  const response = await fetchImpl("/api/summary/suggestion", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Failed to request suggestion: ${response.status}`);
  }
  const payload = (await response.json()) as SummaryChatResponse;
  return payload;
}
