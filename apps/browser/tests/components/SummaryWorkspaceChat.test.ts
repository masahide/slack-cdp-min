import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SummaryWorkspace from "$lib/components/summary/SummaryWorkspace.svelte";
import { createSummaryDraft } from "../helpers/summaryEditor";

const chatApiMock = vi.hoisted(() => ({
  requestSuggestion: vi.fn(),
}));

vi.mock("$lib/client/summary/chat", () => chatApiMock);

describe("SummaryWorkspace LLMチャット (RED)", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    chatApiMock.requestSuggestion.mockReset();
  });

  it("送信ボタンでプロンプトとモデルをAPIに送る", async () => {
    chatApiMock.requestSuggestion.mockResolvedValue({
      delta: "- 提案テキスト",
    });

    render(SummaryWorkspace, {
      draft: createSummaryDraft({ content: "初期" }),
      models: ["gpt-4.1-mini", "gpt-4o"],
      activeModel: "gpt-4.1-mini",
    });

    const textarea = screen.getByPlaceholderText("LLM への指示を書きます");
    await user.type(textarea, "箇条書きを増やして");
    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(chatApiMock.requestSuggestion).toHaveBeenCalledWith({
      model: "gpt-4.1-mini",
      prompt: "箇条書きを増やして",
      content: "初期",
    });

    expect(await screen.findByText("- 提案テキスト")).toBeInTheDocument();
  });

  it("提案を挿入するボタンで差分を草稿に適用する", async () => {
    chatApiMock.requestSuggestion.mockResolvedValue({
      delta: "- 追記テキスト",
    });

    render(SummaryWorkspace, {
      draft: createSummaryDraft({ content: "ベース" }),
      models: ["gpt-4.1-mini"],
      activeModel: "gpt-4.1-mini",
    });

    const textarea = screen.getByPlaceholderText("LLM への指示を書きます");
    await user.type(textarea, "追記して");
    await user.click(screen.getByRole("button", { name: "送信" }));

    const applyButton = await screen.findByRole("button", { name: "提案を挿入" });
    await user.click(applyButton);

    await waitFor(() =>
      expect(screen.getByLabelText("サマリ本文")).toHaveValue("ベース\n- 追記テキスト")
    );
  });

  it("別モデルを選択すると以降のリクエストで反映される", async () => {
    chatApiMock.requestSuggestion.mockResolvedValue({
      delta: "- 改善案",
    });

    const { component } = render(SummaryWorkspace, {
      draft: createSummaryDraft(),
      models: ["gpt-4.1-mini", "gpt-4o"],
      activeModel: "gpt-4.1-mini",
    });

    await user.selectOptions(screen.getByLabelText("LLM モデル"), "gpt-4o");
    component.$set({ activeModel: "gpt-4o" });
    await user.type(screen.getByPlaceholderText("LLM への指示を書きます"), "要約して");
    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(chatApiMock.requestSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" })
    );
  });
});
