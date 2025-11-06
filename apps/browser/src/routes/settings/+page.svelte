<script lang="ts">
  import { browser } from "$app/environment";
  import type { PageData } from "./$types";

  export let data: PageData;

  let templateSource = data.clipboardTemplate.source;
  let baselineSource = data.clipboardTemplate.source;
  const defaultSource = data.clipboardTemplate.defaultSource;
  let origin = data.clipboardTemplate.origin;
  let path = data.clipboardTemplate.path;
  let status: "idle" | "saving" | "success" | "error" | "resetting" = "idle";
  let errorMessage: string | null = null;

  $: isDirty = templateSource !== baselineSource;

  async function saveTemplate() {
    if (!browser) return;
    status = "saving";
    errorMessage = null;
    try {
      const response = await fetch("/api/templates/clipboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: templateSource }),
      });
      if (!response.ok) {
        throw new Error(`保存に失敗しました (${response.status})`);
      }
      const payload = (await response.json()) as {
        source: string;
        origin: typeof origin;
        path: string | null;
      };
      templateSource = payload.source;
      baselineSource = payload.source;
      origin = payload.origin;
      path = payload.path;
      status = "success";
    } catch (error) {
      console.error("テンプレート保存エラー", error);
      status = "error";
      errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました";
    } finally {
      if (status === "success") {
        setTimeout(() => {
          status = "idle";
        }, 2000);
      }
    }
  }

  async function resetTemplate() {
    if (!browser) return;
    status = "resetting";
    errorMessage = null;
    try {
      const response = await fetch("/api/templates/clipboard", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`リセットに失敗しました (${response.status})`);
      }
      const payload = (await response.json()) as {
        source: string;
        origin: typeof origin;
        path: string | null;
      };
      templateSource = payload.source;
      baselineSource = payload.source;
      origin = payload.origin;
      path = payload.path;
      status = "success";
    } catch (error) {
      console.error("テンプレートリセットエラー", error);
      status = "error";
      errorMessage = error instanceof Error ? error.message : "不明なエラーが発生しました";
    } finally {
      if (status === "success") {
        setTimeout(() => {
          status = "idle";
        }, 2000);
      }
    }
  }

  function loadDefaultTemplate() {
    templateSource = defaultSource;
  }
</script>

<svelte:head>
  <title>ReacLog 設定 - テンプレート編集</title>
</svelte:head>

<main class="page">
  <header class="header">
    <div>
      <h1>クリップボードテンプレート</h1>
      <p class="lead">
        クリップボード出力に利用される Handlebars テンプレートを編集できます。保存すると config
        ディレクトリにカスタムテンプレートが作成されます。
      </p>
      <p class="meta">
        現在の状態:
        <span class={origin === "custom" ? "status custom" : "status default"}>
          {origin === "custom" ? "カスタム" : "デフォルト"}
        </span>
        {#if path}
          <span class="path">({path})</span>
        {/if}
      </p>
    </div>
    <nav class="nav">
      <a href="/" class="nav-link">ダッシュボードへ戻る</a>
    </nav>
  </header>

  <section class="editor-section">
    <div class="controls">
      <button type="button" class="button secondary" on:click={loadDefaultTemplate}>
        デフォルトを読み込む
      </button>
      <div class="spacer" />
      <button
        type="button"
        class="button danger"
        on:click={resetTemplate}
        disabled={status === "saving" || status === "resetting"}
      >
        デフォルトに戻す
      </button>
      <button
        type="button"
        class="button primary"
        on:click={saveTemplate}
        disabled={!isDirty || status === "saving" || status === "resetting"}
      >
        {#if status === "saving"}
          保存中…
        {:else}
          保存する
        {/if}
      </button>
    </div>
    <textarea
      bind:value={templateSource}
      spellcheck="false"
      class="editor"
      aria-label="Clipboard template source"
    />
    {#if status === "success"}
      <p class="feedback success">保存しました。</p>
    {:else if status === "error"}
      <p class="feedback error">{errorMessage ?? "保存に失敗しました。"}</p>
    {/if}
  </section>
</main>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .lead {
    margin: 0.75rem 0 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .meta {
    margin-top: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .status {
    font-weight: 600;
  }

  .status.default {
    color: var(--accent);
  }

  .status.custom {
    color: #f97316;
  }

  .path {
    margin-left: 0.5rem;
    font-family: "Fira Code", "Roboto Mono", monospace;
    background: var(--inline-code-bg);
    color: var(--inline-code-text);
    padding: 0.1rem 0.35rem;
    border-radius: 0.35rem;
  }

  .nav {
    display: flex;
    align-items: center;
  }

  .nav-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }

  .editor-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .controls {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .spacer {
    flex-grow: 1;
  }

  .editor {
    width: 100%;
    min-height: 420px;
    font-family:
      "Fira Code", "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
      "Liberation Mono", "Courier New", monospace;
    font-size: 0.9rem;
    line-height: 1.5;
    padding: 1rem;
    border: 1px solid var(--surface-border-strong);
    border-radius: 0.75rem;
    background: var(--surface-card);
    color: var(--text-primary);
    resize: vertical;
  }

  .editor:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .feedback {
    margin: 0;
    font-size: 0.9rem;
  }

  .feedback.success {
    color: var(--accent);
  }

  .feedback.error {
    color: #ef4444;
  }

  .button {
    border-radius: 999px;
    padding: 0.5rem 1.2rem;
    font-size: 0.9rem;
    border: none;
    cursor: pointer;
    transition:
      background 0.2s ease,
      transform 0.2s ease;
  }

  .button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .button.primary {
    background: var(--accent);
    color: #ffffff;
  }

  .button.secondary {
    background: var(--button-muted-bg);
    color: var(--button-muted-text);
  }

  .button.danger {
    background: #ef4444;
    color: #ffffff;
  }

  @media (max-width: 640px) {
    .controls {
      flex-direction: column;
      align-items: stretch;
    }

    .spacer {
      display: none;
    }

    .button {
      width: 100%;
    }
  }
</style>
