import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlWriter } from "../src/io/jsonlWriter.js";
import type { NormalizedEvent } from "../src/core/events.js";

const createEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  schema: "reaclog.event.v1.1",
  uid: overrides.uid ?? "slack:C123@1711111111.000200",
  source: "slack",
  kind: overrides.kind ?? "post",
  actor: "tester",
  subject: "テスト",
  ts: overrides.ts ?? "2024-03-22T21:38:31+09:00",
  logged_at: overrides.logged_at ?? "2024-03-22T21:40:00+09:00",
  meta: overrides.meta ?? { channel: "#dev" },
  detail: overrides.detail ?? {
    slack: { channel_id: "C123", channel_name: "dev", text: "hello" },
  },
});

describe("JsonlWriter", () => {
  it("events.jsonl を日付ディレクトリにappendする", async () => {
    const tmp = await mkdtemp(`${tmpdir()}/reaclog-jsonl-`);
    const writer = new JsonlWriter({ dataDir: tmp });

    const event1 = createEvent();
    const event2 = createEvent({
      uid: "slack:C123@1711112222.000300",
      ts: "2024-03-22T22:00:00+09:00",
      subject: "テスト2",
    });

    await writer.append(event1);
    await writer.append(event2);

    const targetPath = join(tmp, "2024", "03", "22", "slack", "events.jsonl");
    const content = await readFile(targetPath, "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).uid, event1.uid);
    assert.equal(JSON.parse(lines[1]).uid, event2.uid);

    await rm(tmp, { recursive: true, force: true });
  });
});
