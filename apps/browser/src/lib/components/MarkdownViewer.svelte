<script lang="ts">
  import { renderSummaryMarkdown } from "$lib/markdown";

  export let markdown: string | null = null;

  $: rendered = markdown ? renderSummaryMarkdown(markdown) : "";
</script>

{#if rendered}
  <div class="markdown">{@html rendered}</div>
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
