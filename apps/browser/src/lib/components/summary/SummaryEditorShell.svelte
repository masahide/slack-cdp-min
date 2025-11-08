<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { useDebouncedWritable } from "$lib/hooks/useDebouncedWritable";
  import type { SummaryEditorDraft } from "./types";

  export let draft: SummaryEditorDraft;
  export let isBusy = false;

  const dispatch = createEventDispatcher<{
    create: { date: string };
    input: { content: string };
    save: { content: string };
  }>();

  let value = draft?.content ?? "";
  let draftSignature = signature(draft);
  let textareaId = createTextareaId(draft);
  const debouncedInput = useDebouncedWritable(value, {
    delay: 500,
    onFlush: (content) => {
      dispatch("input", { content });
    },
  });

  $: {
    const nextSignature = signature(draft);
    if (nextSignature !== draftSignature) {
      draftSignature = nextSignature;
      value = draft?.content ?? "";
      textareaId = createTextareaId(draft);
      debouncedInput.set(value);
    }
  }

  function handleCreate() {
    dispatch("create", { date: draft?.date ?? "" });
  }

  function handleInput(event: Event) {
    const target = event.currentTarget as HTMLTextAreaElement;
    value = target.value;
    debouncedInput.set(value);
  }

  function handleSave() {
    debouncedInput.flush();
    dispatch("save", { content: value });
  }

  function handleKeydown(event: KeyboardEvent) {
    const isMetaSave = (event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S");
    const isMetaSubmit =
      (event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.code === "Enter");
    if (isMetaSave || isMetaSubmit) {
      event.preventDefault();
      handleSave();
    }
  }

  function signature(input: SummaryEditorDraft | undefined): string {
    if (!input) {
      return "";
    }
    return `${input.date ?? ""}::${input.updatedAt ?? ""}::${input.content ?? ""}`;
  }

  function createTextareaId(input: SummaryEditorDraft | undefined): string {
    const suffix = input?.date ? input.date.replace(/[^a-z0-9_-]/gi, "-") : "unknown";
    return `summary-editor-body-${suffix}`;
  }
</script>

<div class="summary-editor-shell" data-testid="summary-editor-shell">
  <header class="shell-header">
    <h1 class="shell-title">
      日報サマリ <span aria-label="target-date">{draft?.date ?? "未設定"}</span>
    </h1>
    <div class="shell-actions">
      <button type="button" on:click={handleCreate} disabled={isBusy}> サマリを作成 </button>
      <button type="button" on:click={handleSave} disabled={isBusy}> 保存 </button>
    </div>
  </header>

  <section class="shell-body">
    <label class="textarea-label">
      <span class="textarea-caption" id={`${textareaId}-label`}>サマリ本文</span>
      <textarea
        class="summary-input"
        id={textareaId}
        aria-labelledby={`${textareaId}-label`}
        bind:value
        on:input={handleInput}
        on:keydown={handleKeydown}
        spellcheck="false"
      />
    </label>
  </section>
</div>

<style>
  .summary-editor-shell {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .shell-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .shell-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .shell-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .textarea-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .summary-input {
    min-height: 12rem;
    font-family: var(--font-mono, ui-monospace);
    font-size: 0.95rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border-color, #cbd5e1);
    resize: vertical;
  }
</style>
