import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";
import { resolveDataDir } from "$lib/server/config";
import { readDailySummary, readDailySummaryStats, writeDailySummary } from "$lib/server/data";

type SummaryPayload = {
  content: string;
  exists: boolean;
  updatedAt: string | null;
};

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
};

export const GET: RequestHandler = async ({ params }) => {
  const date = params.date;
  if (!date) {
    return json({ error: "date is required." }, { status: 400 });
  }

  const dataDir = resolveDataDir();
  const [content, stats] = await Promise.all([
    readDailySummary({ dataDir, date }),
    readDailySummaryStats(dataDir, date),
  ]);

  return json(buildSummaryPayload(content, stats.exists, stats.updatedAt), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
};

export const POST: RequestHandler = async ({ params }) => {
  const date = params.date;
  if (!date) {
    return json({ error: "date is required." }, { status: 400 });
  }

  const dataDir = resolveDataDir();
  const summary = await readDailySummary({ dataDir, date });
  const stats = await readDailySummaryStats(dataDir, date);

  if (!stats.exists) {
    const content = summary ?? "";
    const { savedAt } = await writeDailySummary({ dataDir, date, content });
    return json(buildSummaryPayload(content, true, savedAt), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  }

  return json(buildSummaryPayload(summary, stats.exists, stats.updatedAt), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const date = params.date;
  if (!date) {
    return json({ error: "date is required." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "JSON body is required." }, { status: 400 });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { content?: unknown }).content !== "string"
  ) {
    return json({ error: "content field is required." }, { status: 400 });
  }

  const content = (payload as { content: string }).content;
  const dataDir = resolveDataDir();
  const { savedAt } = await writeDailySummary({ dataDir, date, content });

  return json(
    { savedAt },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    }
  );
};

function buildSummaryPayload(
  content: string | null,
  exists: boolean,
  updatedAt: string | null
): SummaryPayload {
  return {
    content: content ?? "",
    exists,
    updatedAt,
  };
}
