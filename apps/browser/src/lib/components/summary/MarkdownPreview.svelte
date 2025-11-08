<script lang="ts">
  import { onDestroy } from "svelte";
  import { createMarkdownPipeline } from "$lib/preview/markdownPipeline";

  export let markdown: string | null = null;
  export let debounce = 300;

  const pipeline = createMarkdownPipeline({ debounce });
  let rendered: string | null = null;

  const unsubscribe = pipeline.subscribe((value) => {
    rendered = value;
  });

  $: pipeline.update(markdown ?? null);

  onDestroy(() => {
    unsubscribe();
    pipeline.destroy();
  });
</script>

{#if rendered}
  <div class="markdown" data-testid="markdown-preview">{@html rendered}</div>
{:else}
  <p class="placeholder">サマリがまだありません。</p>
{/if}

<style>
  .markdown :global(code) {
    background: var(--inline-code-bg);
    color: var(--inline-code-text);
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }

  .markdown :global(pre) {
    background: var(--code-block-bg);
    color: var(--code-block-text);
    padding: 0.75rem;
    border-radius: 8px;
    overflow-x: auto;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3) {
    margin-top: 1.2rem;
    margin-bottom: 0.6rem;
  }

  .placeholder {
    color: var(--placeholder-text);
    font-size: 0.9rem;
  }
</style>
