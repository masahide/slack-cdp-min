<script lang="ts">
  import MarkdownViewer from "$lib/components/MarkdownViewer.svelte";
  import { formatIsoDate, formatIsoTimestamp, formatEventTime } from "$lib/format/date";
  import type { PageData } from "./$types";
  import { writable, get } from "svelte/store";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy, tick } from "svelte";

  export let data: PageData;

  const dateLabel = formatIsoDate(data.date);
  const lastEvent = data.events[data.events.length - 1];
  const lastUpdated = formatIsoTimestamp(lastEvent?.loggedAt ?? `${data.date}T00:00:00`);

  const selectedSources = writable(
    data.sources.filter((source) => source.selected).map((source) => source.name)
  );

  let initialSync = true;
  const unsubscribe = selectedSources.subscribe(async (selection) => {
    if (initialSync) {
      initialSync = false;
      return;
    }

    await tick();
    const current = get(page);
    const params = new URLSearchParams(current.url.search);

    const currentQuery = params.getAll("source").sort();
    const nextQuery = [...selection].sort();
    const isEqual =
      currentQuery.length === nextQuery.length &&
      currentQuery.every((value, index) => value === nextQuery[index]);

    if (isEqual) {
      return;
    }

    params.delete("source");
    selection.forEach((source) => params.append("source", source));

    const query = params.toString();
    await goto(`${current.url.pathname}${query ? `?${query}` : ""}`, {
      replaceState: true,
      keepfocus: true,
      noScroll: true,
    });
  });

  onDestroy(unsubscribe);

  const toggleSource = (name: string, checked: boolean) => {
    selectedSources.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return Array.from(next);
    });
  };

  const describeEvent = (event: (typeof data.events)[number]) => {
    const raw = event.raw as Record<string, unknown>;
    if (typeof raw.subject === "string" && raw.subject.trim().length > 0) {
      return raw.subject;
    }
    const detail = raw.detail as Record<string, Record<string, unknown>> | undefined;
    const scoped = detail?.[event.source];
    if (scoped) {
      if (typeof scoped.text === "string") {
        return scoped.text;
      }
      if (typeof scoped.title === "string") {
        return scoped.title;
      }
    }
    return event.uid;
  };

  const isSelected = (name: string, selection: string[]) => selection.includes(name);
</script>

<svelte:head>
  <title>{dateLabel} のログ</title>
</svelte:head>

<main class="layout">
  <header class="page-header">
    <div>
      <a class="back-link" href="/">← ダッシュボードに戻る</a>
      <h1>{dateLabel} のログ</h1>
      <p class="updated-at">最終記録: {lastUpdated}</p>
    </div>
  </header>

  <section class="filters">
    <h2>ソースフィルタ</h2>
    {#if data.sources.length === 0}
      <p class="empty">この日に取得されたイベントはありません。</p>
    {:else}
      <form method="get" class="source-form" on:submit|preventDefault>
        {#each data.sources as source}
          <label class="source-option">
            <input
              type="checkbox"
              name="source"
              value={source.name}
              checked={isSelected(source.name, $selectedSources)}
              on:change={(event) => toggleSource(source.name, event.currentTarget.checked)}
            />
            <span class="name">{source.name}</span>
            <span class="count">({source.count})</span>
          </label>
        {/each}
      </form>
    {/if}
  </section>

  <section class="content">
    <div class="timeline">
      <h2>タイムライン</h2>
      {#if data.events.length === 0}
        <p class="empty">表示対象のイベントがありません。</p>
      {:else}
        <ul>
          {#each data.events as event}
            <li class="timeline-item">
              <div class="time">{formatEventTime(event.ts, data.date)}</div>
              <div class="body">
                <span class="source-tag">{event.source}</span>
                <p class="description">{describeEvent(event)}</p>
                <details>
                  <summary>詳細</summary>
                  <pre>{JSON.stringify(event.raw, null, 2)}</pre>
                </details>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if data.summary}
      <aside class="summary">
        <h2>Markdown サマリ</h2>
        <MarkdownViewer markdown={data.summary} />
      </aside>
    {/if}
  </section>
</main>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  .page-header h1 {
    margin-top: 0.5rem;
  }

  .back-link {
    color: #2563eb;
    font-size: 0.9rem;
    text-decoration: none;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  .updated-at {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: #555;
  }

  .filters {
    border: 1px solid #ddd;
    border-radius: 12px;
    padding: 1rem 1.5rem;
    background: #fff;
  }

  .source-form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: center;
  }

  .source-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.95rem;
  }

  .source-option input {
    width: 1rem;
    height: 1rem;
  }

  .source-option .name {
    text-transform: capitalize;
  }

  .source-option .count {
    color: #555;
    font-size: 0.85rem;
  }

  .content {
    display: grid;
    gap: 1.5rem;
  }

  @media (min-width: 960px) {
    .content {
      grid-template-columns: 2fr 1fr;
    }
  }

  .timeline ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .timeline-item {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 1rem;
    align-items: start;
  }

  .time {
    font-weight: 600;
    color: #444;
    font-size: 0.95rem;
  }

  .body {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 0.9rem 1rem;
    background: #fff;
  }

  .source-tag {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    border-radius: 6px;
    background: #f1f5f9;
    color: #2563eb;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .description {
    margin: 0.6rem 0;
    font-size: 0.95rem;
    color: #1f2933;
  }

  details {
    font-size: 0.85rem;
  }

  details pre {
    margin-top: 0.5rem;
    background: #0f172a;
    color: #f8fafc;
    padding: 0.75rem;
    border-radius: 8px;
    white-space: pre-wrap;
  }

  .summary {
    border: 1px solid #ddd;
    border-radius: 12px;
    padding: 1rem;
    background: #fff;
  }

  .summary :global(.markdown) {
    margin-top: 0.75rem;
  }

  .empty {
    color: #777;
  }
</style>
