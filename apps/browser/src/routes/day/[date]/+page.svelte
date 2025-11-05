<script lang="ts">
  import MarkdownViewer from "$lib/components/MarkdownViewer.svelte";
  import { formatIsoDate, formatIsoTimestamp, formatEventTime } from "$lib/format/date";
  import type { PageData } from "./$types";
  import type { TimelineEvent } from "$lib/server/types";
  import { writable, derived, get } from "svelte/store";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount, onDestroy, tick } from "svelte";
  import { browser } from "$app/environment";
  import {
    accumulateSource,
    computeLastTimestamp,
    insertEvent,
    parseTimelineEvent,
  } from "$lib/client/timeline";
  import UpdateToast from "$lib/components/UpdateToast.svelte";
  import { themeController, type ThemeMode } from "$lib/client/theme";
  import {
    classifyEventKind,
    getEventChannelLabel,
    getEventPresentation,
    getReactionEmoji,
    type EventPresentation,
    type EventKind,
  } from "$lib/presentation/event";

  export let data: PageData;

  const dateLabel = formatIsoDate(data.date);

  const themeMode = themeController.mode;

  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: "light", label: "ライト" },
    { value: "dark", label: "ダーク" },
    { value: "system", label: "システム" },
  ];

  const events = writable([...data.events]);
  const sourcesStore = writable([...data.sources]);
  const selectedSources = writable(
    data.sources.filter((source) => source.selected).map((source) => source.name)
  );
  const filteredEvents = derived([events, selectedSources], ([all, selection]) => {
    if (selection.length === 0) {
      return all;
    }
    const allowed = new Set(selection);
    return all.filter((event) => allowed.has(event.source));
  });

  let lastUpdated = formatIsoTimestamp(computeLastTimestamp(data.events, data.date));

  const deliveredUids = new Set<string>(data.events.map((event) => event.uid));

  const unsubscribeEvents = events.subscribe((value) => {
    lastUpdated = formatIsoTimestamp(computeLastTimestamp(value, data.date));
  });

  let eventSource: EventSource | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackActive = false;

  const toastVisible = writable(false);
  const toastMessage = writable("更新があります");

  onMount(() => {
    if (!browser) {
      return;
    }
    initRealtimeStream();
  });

  let initialSync = true;
  const unsubscribeSelection = selectedSources.subscribe(async (selection) => {
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

  onDestroy(() => {
    unsubscribeSelection();
    unsubscribeEvents();
    eventSource?.close();
    stopFallback();
  });

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

  const presentationCache = new Map<string, EventPresentation>();

  const displayBadge = (event: TimelineEvent) => {
    const kind = classifyEventKind(event);
    if (kind === "reaction") {
      const emoji = getReactionEmoji(event);
      return emoji ? `Reaction :${emoji}:` : "Reaction";
    }
    if (kind === "post") {
      return "Post";
    }
    return event.source;
  };

  const describeEvent = (event: TimelineEvent) => getPresentation(event).text;

  const renderEventContent = (event: TimelineEvent) => getPresentation(event).html;

  function getPresentation(event: TimelineEvent): EventPresentation {
    const cached = presentationCache.get(event.uid);
    if (cached) {
      return cached;
    }
    const presentation = getEventPresentation(event);
    presentationCache.set(event.uid, presentation);
    return presentation;
  }

  const isSelected = (name: string, selection: string[]) => selection.includes(name);

  const handleThemeChange = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as ThemeMode;
    themeController.setTheme(value);
  };

  const toggleTheme = () => {
    themeController.toggle();
  };

  function handleIncomingEvent(event: TimelineEvent) {
    if (deliveredUids.has(event.uid)) {
      presentationCache.delete(event.uid);
      return;
    }
    deliveredUids.add(event.uid);
    presentationCache.delete(event.uid);
    events.update((current) => insertEvent(current, event));
    sourcesStore.update((current) => {
      const { options, added } = accumulateSource(current, event.source);
      if (added) {
        selectedSources.update((selection) => {
          if (selection.includes(added)) {
            return selection;
          }
          return [...selection, added];
        });
      }
      return options;
    });
  }

  function initRealtimeStream() {
    eventSource?.close();
    const source = new EventSource(`/day/${data.date}/stream`);
    source.addEventListener("timeline", (event) => {
      const payload = parseTimelineEvent((event as MessageEvent<string>).data);
      if (payload) {
        handleIncomingEvent(payload);
      }
    });
    source.addEventListener("open", () => {
      stopFallback();
    });
    source.addEventListener("error", () => {
      source.close();
      startFallback();
    });
    eventSource = source;
  }

  function startFallback() {
    if (fallbackActive) {
      return;
    }
    fallbackActive = true;
    toastMessage.set("リアルタイム接続が不安定です。一定間隔で更新を確認します。");
    toastVisible.set(true);
    pollEvents();
    fallbackTimer = setInterval(pollEvents, 5000);
    reconnectTimer = setInterval(() => {
      if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
        initRealtimeStream();
      }
    }, 15000);
  }

  function stopFallback() {
    if (!fallbackActive) {
      return;
    }
    fallbackActive = false;
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
    toastVisible.set(false);
  }

  async function pollEvents() {
    try {
      const response = await fetch(`/day/${data.date}/events`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        events: TimelineEvent[];
      };
      const newEvents = payload.events.filter((event) => !deliveredUids.has(event.uid));
      if (newEvents.length > 0) {
        newEvents.forEach((event) => handleIncomingEvent(event));
        toastMessage.set("新しいイベントを取り込みました。最新の表示を確認してください。");
        toastVisible.set(true);
      }
    } catch (error) {
      console.warn("fallback polling failed", error);
    }
  }

  const acknowledgeToast = () => {
    toastVisible.set(false);
  };

  const refreshFromToast = async () => {
    await pollEvents();
    toastVisible.set(false);
  };
</script>

<svelte:head>
  <title>{dateLabel} のログ</title>
</svelte:head>

<main class="layout">
  <header class="page-header">
    <div class="header-main">
      <a class="back-link" href="/">← ダッシュボードに戻る</a>
      <h1>{dateLabel} のログ</h1>
      <p class="updated-at">最終記録: {lastUpdated}</p>
    </div>
    <div class="header-actions">
      <label class="theme-label" for="theme-select">テーマ</label>
      <div class="theme-controls">
        <select id="theme-select" bind:value={$themeMode} on:change={handleThemeChange}>
          {#each themeOptions as option}
            <option value={option.value}>
              {option.label}
            </option>
          {/each}
        </select>
        <button type="button" class="theme-toggle" on:click={toggleTheme}>切替</button>
      </div>
    </div>
  </header>

  <section class="filters">
    <h2>ソースフィルタ</h2>
    {#if $sourcesStore.length === 0}
      <p class="empty">この日に取得されたイベントはありません。</p>
    {:else}
      <form method="get" class="source-form" on:submit|preventDefault>
        {#each $sourcesStore as source}
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
      {#if $filteredEvents.length === 0}
        <p class="empty">表示対象のイベントがありません。</p>
      {:else}
        <ul>
          {#each $filteredEvents as event}
            <li class="timeline-item">
              <div class="time">{formatEventTime(event.ts, data.date)}</div>
              <div class="body">
                <div class="meta-line">
                  <span class={`source-tag kind-${classifyEventKind(event)}`}>
                    {displayBadge(event)}
                  </span>
                  {#if getEventChannelLabel(event)}
                    <span class="channel-tag">{getEventChannelLabel(event)}</span>
                  {/if}
                </div>
                <div class="description" aria-label={`本文: ${describeEvent(event)}`}>
                  {@html renderEventContent(event)}
                </div>
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

  <UpdateToast
    visible={$toastVisible}
    message={$toastMessage}
    on:refresh={refreshFromToast}
    on:dismiss={acknowledgeToast}
  />
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

  .page-header {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  @media (min-width: 768px) {
    .page-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .page-header h1 {
    margin-top: 0.5rem;
    color: var(--text-primary);
  }

  .back-link {
    color: var(--accent);
    font-size: 0.9rem;
    text-decoration: none;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  .updated-at {
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .theme-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .theme-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
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

  .filters {
    border: 1px solid var(--surface-border-strong);
    border-radius: 12px;
    padding: 1rem 1.5rem;
    background: var(--surface-card);
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
    color: var(--text-primary);
  }

  .source-option input {
    width: 1rem;
    height: 1rem;
  }

  .source-option .name {
    text-transform: capitalize;
  }

  .source-option .count {
    color: var(--text-secondary);
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
    color: var(--text-secondary);
    font-size: 0.95rem;
  }

  .body {
    border: 1px solid var(--surface-border-strong);
    border-radius: 12px;
    padding: 0.9rem 1rem;
    background: var(--surface-card);
  }

  .meta-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .source-tag {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 600;
    border: 1px solid transparent;
  }

  .kind-post {
    background: rgba(59, 130, 246, 0.15);
    color: #1d4ed8;
    border-color: rgba(59, 130, 246, 0.25);
  }

  [data-theme="dark"] .kind-post {
    background: rgba(96, 165, 250, 0.2);
    color: #bfdbfe;
    border-color: rgba(96, 165, 250, 0.3);
  }

  .kind-reaction {
    background: rgba(16, 185, 129, 0.15);
    color: #047857;
    border-color: rgba(16, 185, 129, 0.25);
  }

  [data-theme="dark"] .kind-reaction {
    background: rgba(52, 211, 153, 0.2);
    color: #bbf7d0;
    border-color: rgba(52, 211, 153, 0.3);
  }

  .channel-tag {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.18);
    color: var(--text-secondary);
    font-size: 0.75rem;
    padding: 0.15rem 0.55rem;
    letter-spacing: 0.02em;
  }

  [data-theme="dark"] .channel-tag {
    background: rgba(148, 163, 184, 0.22);
    color: #cbd5f5;
  }

  .description {
    margin: 0.6rem 0;
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  details {
    font-size: 0.85rem;
  }

  details pre {
    margin-top: 0.5rem;
    background: var(--code-block-bg);
    color: var(--code-block-text);
    padding: 0.75rem;
    border-radius: 8px;
    white-space: pre-wrap;
  }

  .summary {
    border: 1px solid var(--surface-border-strong);
    border-radius: 12px;
    padding: 1rem;
    background: var(--surface-card);
  }

  .summary :global(.markdown) {
    margin-top: 0.75rem;
  }

  .empty {
    color: var(--text-secondary);
  }
</style>
