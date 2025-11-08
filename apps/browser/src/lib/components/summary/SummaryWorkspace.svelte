<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import SummaryEditorShell from "$lib/components/summary/SummaryEditorShell.svelte";
  import MarkdownPreview from "$lib/components/summary/MarkdownPreview.svelte";
  import { requestSuggestion } from "$lib/client/summary/chat";
  import type { SummaryEditorDraft, SummaryWorkspaceEvents } from "./types";

  export let draft: SummaryEditorDraft;
  export let models: string[] = [];
  export let activeModel: string | null = null;
  export let isChatBusy = false;
  export let isEditorBusy = false;
  export let lastSavedAt: string | null = null;
  export let lastSavedLabel: string | null = null;
  export let errorMessage: string | null = null;

  const dispatch = createEventDispatcher<SummaryWorkspaceEvents>();

  type Suggestion = {
    id: number;
    text: string;
  };

  let prompt = "";
  let selectedModel = activeModel ?? models[0] ?? "";
  let draftSignature = signature(draft);
  let editorDraft: SummaryEditorDraft = { ...draft };
  let suggestions: Suggestion[] = [];
  let localChatBusy = false;
  let suggestionSeq = 0;

  $: {
    if (activeModel && activeModel !== selectedModel) {
      selectedModel = activeModel;
    } else if (!activeModel && selectedModel === "" && models.length > 0) {
      selectedModel = models[0];
    }
  }

  $: {
    const nextSignature = signature(draft);
    if (nextSignature !== draftSignature) {
      draftSignature = nextSignature;
      editorDraft = { ...draft };
    }
  }

  const chatBusy = () => isChatBusy || localChatBusy;

  const currentModel = () => selectedModel || models[0] || "";

  async function handlePromptSubmit() {
    const model = currentModel();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !model || chatBusy()) {
      return;
    }
    localChatBusy = true;
    try {
      const response = await requestSuggestion({
        model,
        prompt: trimmedPrompt,
        content: editorDraft.content,
      });
      suggestionSeq += 1;
      suggestions = [
        ...suggestions,
        {
          id: suggestionSeq,
          text: response.delta,
        },
      ];
      dispatch("promptsubmit", { prompt: trimmedPrompt, model });
      prompt = "";
    } catch (error) {
      console.error("requestSuggestion failed", error);
    } finally {
      localChatBusy = false;
    }
  }

  function handleModelChange(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const nextModel = select.value;
    selectedModel = nextModel;
    dispatch("modelchange", { model: nextModel });
  }

  function handleDraftInput(event: CustomEvent<{ content: string }>) {
    editorDraft = { ...editorDraft, content: event.detail.content };
    dispatch("draftinput", event.detail);
  }

  function handleDraftSave(event: CustomEvent<{ content: string }>) {
    editorDraft = { ...editorDraft, content: event.detail.content };
    dispatch("draftsave", event.detail);
  }

  function applySuggestion(suggestion: Suggestion) {
    const nextContent = [editorDraft.content, suggestion.text].filter(Boolean).join("\n");
    updateEditorDraft(nextContent);
  }

  function updateEditorDraft(content: string) {
    editorDraft = { ...editorDraft, content };
    dispatch("draftinput", { content });
  }

  function signature(input: SummaryEditorDraft): string {
    return `${input.date ?? ""}::${input.updatedAt ?? ""}::${input.content ?? ""}`;
  }
</script>

<div class="summary-workspace">
  <section class="pane chat" aria-label="LLM チャット">
    <header class="pane-header">
      <h2>LLM チャット</h2>
      <label class="model-selector">
        <span>モデル</span>
        <select
          aria-label="LLM モデル"
          on:change={handleModelChange}
          disabled={models.length === 0 || chatBusy()}
          bind:value={selectedModel}
        >
          {#each models as model}
            <option value={model}>{model}</option>
          {/each}
        </select>
      </label>
    </header>
    <textarea
      class="prompt-input"
      placeholder="LLM への指示を書きます"
      bind:value={prompt}
      disabled={chatBusy()}
    />
    <button class="prompt-submit" type="button" on:click={handlePromptSubmit} disabled={chatBusy()}>
      送信
    </button>

    {#if suggestions.length > 0}
      <section class="suggestions">
        <h3>提案</h3>
        <ul>
          {#each suggestions as suggestion}
            <li>
              <pre>{suggestion.text}</pre>
              <div class="suggestion-actions">
                <button type="button" on:click={() => applySuggestion(suggestion)}
                  >提案を挿入</button
                >
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </section>

  <section class="pane editor" aria-label="Markdown 編集">
    <SummaryEditorShell
      isBusy={isEditorBusy}
      draft={editorDraft}
      on:input={handleDraftInput}
      on:save={handleDraftSave}
    />
    <div class="status-list">
      {#if lastSavedLabel}
        <p class="status saved-at">最終保存: {lastSavedLabel}</p>
      {:else if lastSavedAt}
        <p class="status saved-at">最終保存: {lastSavedAt}</p>
      {/if}
      {#if errorMessage}
        <p class="status error" role="alert">{errorMessage}</p>
      {/if}
    </div>
  </section>

  <section class="pane preview" aria-label="Markdown プレビュー">
    <header class="pane-header">
      <h2>Markdown プレビュー</h2>
    </header>
    <div class="preview-body">
      <MarkdownPreview markdown={editorDraft.content} debounce={300} />
    </div>
  </section>
</div>

<style src="./summaryWorkspace.css"></style>
