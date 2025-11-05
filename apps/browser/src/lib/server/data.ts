import { promises as fs } from "node:fs";
import { join } from "node:path";

import type {
  DailyEventsResult,
  ReadDailyEventsOptions,
  ReadDailySummaryOptions,
  TimelineEvent,
} from "./types";

type ErrnoException = NodeJS.ErrnoException;

const eventsCache = new Map<string, DailyEventsResult>();
const summaryCache = new Map<string, string | null>();

export async function readDailyEvents(options: ReadDailyEventsOptions): Promise<DailyEventsResult> {
  const { dataDir, date } = options;
  const cacheKey = createCacheKey(dataDir, date);

  if (options.cache !== false && eventsCache.has(cacheKey)) {
    return eventsCache.get(cacheKey)!;
  }

  const { year, month, day } = splitDate(date);
  const dayRoot = join(dataDir, year, month, day);

  const events: TimelineEvent[] = [];
  const bySource: Record<string, number> = {};

  const dirEntries = await safeReaddir(dayRoot);
  await Promise.all(
    dirEntries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }
      if (entry.name === "summaries") {
        return;
      }

      const source = entry.name;
      const jsonlPath = join(dayRoot, source, "events.jsonl");
      const parsedEvents = await readJsonlFile(jsonlPath);

      parsedEvents.forEach((raw) => {
        const record = normalizeEvent(raw, source);
        events.push(record);
        bySource[record.source] = (bySource[record.source] ?? 0) + 1;
      });
    })
  );

  events.sort((a, b) => {
    const diff = timestampOf(a) - timestampOf(b);
    if (diff !== 0) {
      return diff;
    }
    return a.uid.localeCompare(b.uid);
  });

  const result: DailyEventsResult = { events, bySource };

  if (options.cache !== false) {
    eventsCache.set(cacheKey, result);
  }

  return result;
}

export async function readDailySummary(options: ReadDailySummaryOptions): Promise<string | null> {
  const { dataDir, date } = options;
  const cacheKey = createCacheKey(dataDir, date);
  if (options.cache !== false && summaryCache.has(cacheKey)) {
    return summaryCache.get(cacheKey)!;
  }

  const { year, month, day } = splitDate(date);
  const summaryPath = join(dataDir, year, month, day, "summaries", "daily.md");

  try {
    const content = await fs.readFile(summaryPath, "utf-8");
    if (options.cache !== false) {
      summaryCache.set(cacheKey, content);
    }
    return content;
  } catch (error) {
    if (isNotFoundError(error)) {
      if (options.cache !== false) {
        summaryCache.set(cacheKey, null);
      }
      return null;
    }
    throw error;
  }
}

function splitDate(date: string): { year: string; month: string; day: string } {
  const [year, month, day] = date.split("-");
  return { year, month, day };
}

async function safeReaddir(path: string) {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

export async function readJsonlFile(
  filePath: string
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  try {
    const content = await fs.readFile(filePath, "utf-8");
    content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          records.push(parsed);
        } catch {
          // JSONL の破損行は読み飛ばす
        }
      });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  return records;
}

export function normalizeEvent(raw: Record<string, unknown>, fallbackSource: string): TimelineEvent {
  const uid = typeof raw.uid === "string" ? raw.uid : createSyntheticUid(raw);
  const source =
    typeof raw.source === "string" && raw.source.length > 0 ? raw.source : fallbackSource;
  const ts = typeof raw.ts === "string" ? raw.ts : null;
  const loggedAt =
    typeof raw.logged_at === "string"
      ? raw.logged_at
      : typeof raw.loggedAt === "string"
        ? raw.loggedAt
        : null;
  return { uid, source, ts, loggedAt, raw };
}

function timestampOf(event: TimelineEvent): number {
  const tsValue = event.ts ?? event.loggedAt;
  if (!tsValue) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Date.parse(tsValue);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function createSyntheticUid(raw: Record<string, unknown>): string {
  const detail = typeof raw.detail === "object" && raw.detail !== null ? raw.detail : {};
  const detailHash = JSON.stringify(detail).slice(0, 24);
  return `synthetic:${detailHash}`;
}

function isNotFoundError(error: unknown): error is ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as ErrnoException).code === "ENOENT"
  );
}

function createCacheKey(dataDir: string, date: string): string {
  return `${dataDir}|${date}`;
}
