import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSlackReaction } from "../src/slack/normalize.js";

describe("normalizeSlackReaction", () => {
  it("SlackリアクションをNormalizedEventへ変換する", () => {
    const normalized = normalizeSlackReaction(
      {
        channel: { id: "C123", name: "dev-infra" },
        user: { id: "U111", name: "sato" },
        item_ts: "1711112222.000300",
        action: "added",
        reaction: "+1",
        event_ts: "1711113333.000400",
      },
      { now: new Date("2024-03-22T13:20:00Z") }
    );

    assert.equal(normalized.schema, "reaclog.event.v1.1");
    assert.equal(normalized.source, "slack");
    assert.equal(normalized.kind, "reaction");
    assert.equal(normalized.action, "added");
    assert.equal(normalized.uid, "slack:C123@1711112222.000300:+1");
    assert.equal(normalized.actor, "sato");
    assert.equal(normalized.meta?.channel, "#dev-infra");
    assert.equal(normalized.meta?.emoji, "+1");
    const detail = normalized.detail;
    assert.ok(detail && "slack" in detail);
    const slackDetail = detail.slack as { channel_id: string; emoji?: string; message_ts?: string };
    assert.equal(slackDetail.channel_id, "C123");
    assert.equal(slackDetail.emoji, "+1");
    assert.equal(slackDetail.message_ts, "1711112222.000300");
    assert.equal(normalized.ts, "2024-03-22T22:15:33+09:00");
    assert.equal(normalized.logged_at, "2024-03-22T22:20:00+09:00");
  });
});
