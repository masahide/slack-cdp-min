import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resetConfigCache } from "../src/lib/server/config";
import { load as dashboardLoad } from "../src/routes/+page.server";
import { load as dayLoad } from "../src/routes/day/[date]/+page.server";
import { load as rawLoad } from "../src/routes/day/[date]/raw/+page.server";

describe("End-to-end data flow", () => {
  let dataDir: string;
  const originalDataDir = process.env.REACLOG_DATA_DIR;
  const originalHealth = process.env.REACLOG_HEALTH_ENDPOINT;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "reaclog-e2e-"));
    process.env.REACLOG_DATA_DIR = dataDir;
    process.env.REACLOG_HEALTH_ENDPOINT = "http://localhost:8799/health";
    resetConfigCache();
    seedDataset();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    resetConfigCache();
    if (originalDataDir) {
      process.env.REACLOG_DATA_DIR = originalDataDir;
    } else {
      delete process.env.REACLOG_DATA_DIR;
    }

    if (originalHealth) {
      process.env.REACLOG_HEALTH_ENDPOINT = originalHealth;
    } else {
      delete process.env.REACLOG_HEALTH_ENDPOINT;
    }
  });

  it("ダッシュボードから日次詳細、生データまで一連のロードが成功する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", message: "All systems" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const dashboard = await dashboardLoad({
      depends: vi.fn(),
      locals: {},
      params: {},
      url: new URL("http://example.test/"),
      fetch: fetchMock,
      setHeaders: vi.fn(),
    } as never);

    expect(dashboard.days[0]).toMatchObject({ date: "2025-11-03", total: 2 });
    expect(dashboard.health?.status).toBe("ok");

    const day = await dayLoad({
      depends: vi.fn(),
      locals: {},
      params: { date: "2025-11-03" },
      url: new URL("http://example.test/day/2025-11-03"),
      fetch: vi.fn(),
      setHeaders: vi.fn(),
    } as never);

    expect(day.events).toHaveLength(2);
    expect(day.summary).toContain("## Done");

    const raw = await rawLoad({
      depends: vi.fn(),
      locals: {},
      params: { date: "2025-11-03" },
      url: new URL("http://example.test/day/2025-11-03/raw"),
      fetch: vi.fn(),
      setHeaders: vi.fn(),
    } as never);

    const slackRaw = raw.files.find((file) => file.source === "slack");
    expect(slackRaw?.lines).toContainEqual(
      JSON.stringify({ uid: "1", source: "slack", kind: "post" })
    );
  });

  function seedDataset() {
    const base = join(dataDir, "2025", "11", "03");
    mkdirSync(join(base, "slack"), { recursive: true });
    writeFileSync(
      join(base, "slack", "events.jsonl"),
      `${JSON.stringify({ uid: "1", source: "slack", kind: "post" })}\n${JSON.stringify({
        uid: "2",
        source: "slack",
        kind: "reaction",
      })}\n`
    );
    mkdirSync(join(base, "summaries"), { recursive: true });
    writeFileSync(join(base, "summaries", "daily.md"), "# 2025-11-03\n\n## Done\n- sample");
  }
});
