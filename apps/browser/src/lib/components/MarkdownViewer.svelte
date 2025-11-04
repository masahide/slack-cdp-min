<script lang="ts">
  import { marked } from "marked";

  export let markdown: string | null = null;

  marked.setOptions({
    breaks: true,
    mangle: false,
    headerIds: false,
  });

  $: rendered = markdown ? marked.parse(markdown) : "";
</script>

{#if rendered}
  <div class="markdown">{@html rendered}</div>
{:else}
  <p class="placeholder">サマリがまだありません。</p>
{/if}

<style>
  .markdown :global(code) {
    background: #f1f5f9;
    padding: 0.15rem 0.3rem;
    border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }

  .markdown :global(pre) {
    background: #0f172a;
    color: #f8fafc;
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
    color: #777;
    font-size: 0.9rem;
  }
</style>
