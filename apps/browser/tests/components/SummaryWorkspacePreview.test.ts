import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import SummaryWorkspace from "$lib/components/summary/SummaryWorkspace.svelte";
import { createSummaryDraft } from "../helpers/summaryEditor";

describe("SummaryWorkspace プレビュー更新 (RED)", () => {
  it("300ms 未満ではプレビューが更新されない", async () => {
    vi.useFakeTimers();
    const { component } = render(SummaryWorkspace, {
      draft: createSummaryDraft({ content: "# 初期" }),
      models: ["gpt-4.1-mini"],
      activeModel: "gpt-4.1-mini",
    });

    component.$set({
      draft: createSummaryDraft({ content: "# 新しい見出し" }),
    });
    await tick();

    expect(screen.queryByText("新しい見出し")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByText("新しい見出し")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
