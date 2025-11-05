<script lang="ts">
  import DaySummaryCard from "$lib/components/DaySummaryCard.svelte";
  import { formatIsoTimestamp } from "$lib/format/date";
  import { themeController, type ThemeMode } from "$lib/client/theme";
  import type { DashboardLoadData } from "$lib/viewModels/dashboard";
  import type { PageData } from "./$types";

  export let data: PageData;

  const formatTimestamp = formatIsoTimestamp;

  const resolveHealthClass = (status: DashboardLoadData["health"]) => {
    if (!status) {
      return "unknown";
    }
    return status.status === "ok" ? "healthy" : "warning";
  };

  const themeMode = themeController.mode;

  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: "light", label: "ライト" },
    { value: "dark", label: "ダーク" },
    { value: "system", label: "システム" },
  ];

  const handleThemeChange = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as ThemeMode;
    themeController.setTheme(value);
  };

  const toggleTheme = () => {
    themeController.toggle();
  };
</script>

<svelte:head>
  <title>ReacLog ダッシュボード</title>
</svelte:head>

<main class="container">
  <header class="header">
    <div class="header-main">
      <h1>ReacLog ブラウザビュー</h1>
      <p class="generated-at">最終更新: {formatTimestamp(data.generatedAt)}</p>
    </div>
    <div class="header-side">
      <div class="status">
        <span class="status-label">CDP ステータス:</span>
        <span class={resolveHealthClass(data.health)}>
          {#if data.health}
            {data.health.message}
          {:else}
            未取得
          {/if}
        </span>
      </div>
      <label class="theme-label" for="dashboard-theme">テーマ</label>
      <div class="theme-controls">
        <select id="dashboard-theme" bind:value={$themeMode} on:change={handleThemeChange}>
          {#each themeOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <button type="button" class="theme-toggle" on:click={toggleTheme}>切替</button>
      </div>
    </div>
  </header>

  <section class="cards">
    <h2>最近の活動ログ</h2>
    {#if data.days.length === 0}
      <p class="empty">表示できるログがまだありません。</p>
    {:else}
      <div class="grid">
        {#each data.days as day}
          <DaySummaryCard {day} />
        {/each}
      </div>
    {/if}
  </section>
</main>

<style>
  .container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 2rem;
    max-width: 960px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .header-main {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .header-side {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .generated-at {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .status-label {
    font-weight: 600;
  }

  .unknown {
    color: var(--text-secondary);
  }

  .healthy {
    color: var(--accent);
  }

  .warning {
    color: #f97316;
  }

  .cards h2 {
    margin-bottom: 1rem;
  }

  .grid {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 720px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .empty {
    color: var(--placeholder-text);
  }

  .theme-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .theme-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  select {
    border-radius: 999px;
    border: 1px solid var(--surface-border-strong);
    background: var(--surface-card);
    color: var(--text-primary);
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    appearance: none;
  }

  select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .theme-toggle {
    border: none;
    background: var(--button-muted-bg);
    color: var(--button-muted-text);
    border-radius: 999px;
    padding: 0.35rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .theme-toggle:hover {
    background: var(--accent);
    color: #fff;
    transform: translateY(-1px);
  }
</style>
