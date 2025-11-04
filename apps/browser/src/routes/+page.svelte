<script lang="ts">
  import DaySummaryCard from "$lib/components/DaySummaryCard.svelte";
  import { formatIsoTimestamp } from "$lib/format/date";
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
</script>

<svelte:head>
  <title>ReacLog ダッシュボード</title>
</svelte:head>

<main class="container">
  <header class="header">
    <div>
      <h1>ReacLog ブラウザビュー</h1>
      <p class="generated-at">最終更新: {formatTimestamp(data.generatedAt)}</p>
    </div>
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
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .generated-at {
    margin-top: 0.5rem;
    font-size: 0.875rem;
    color: #555;
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
    color: #999;
  }

  .healthy {
    color: #1b873f;
  }

  .warning {
    color: #c53d13;
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
    color: #777;
  }
</style>
