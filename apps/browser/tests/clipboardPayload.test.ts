import { describe, expect, it } from "vitest";

import { buildClipboardPayload } from "$lib/presentation/clipboard";
import type { TimelineEvent } from "$lib/server/types";

const baseEvent = (
  overrides: Partial<TimelineEvent> & { raw?: Record<string, unknown> }
): TimelineEvent => {
  return {
    uid: "event-1",
    source: "slack",
    ts: "2025-11-05T10:00:00+09:00",
    loggedAt: "2025-11-05T10:00:00+09:00",
    raw: {
      subject: "[#test] reaction",
      actor: "tester",
      meta: { channel: "#test" },
      detail: { slack: { channel_name: "#test", message_text: "本文" } },
      ...overrides.raw,
    },
    ...overrides,
  } as TimelineEvent;
};

describe("buildClipboardPayload", () => {
  it("summary とイベントを整形する", () => {
    const events: TimelineEvent[] = [
      baseEvent({
        uid: "event-post",
        source: "slack",
        raw: {
          subject: "[#test] post",
          actor: "tester",
          meta: { channel: "#test" },
          detail: { slack: { channel_name: "#test", message_text: "ポスト本文" } },
        },
      }),
      baseEvent({
        uid: "event-reaction",
        raw: {
          subject: "[#test] reaction smile",
          actor: "tester",
          meta: { channel: "#test", emoji: "smile" },
          detail: {
            slack: { channel_name: "#test", emoji: "smile", message_text: "リアクション本文" },
          },
        },
      }),
    ];

    const payload = buildClipboardPayload("2025-11-05", events, "まとめ");
    expect(payload).toContain("# ReacLog 2025-11-05");
    expect(payload).toContain("## Summary");
    expect(payload).toContain("## Events");
    expect(payload).toContain("- **[#test] post** (#test)");
    expect(payload).toContain("- **[#test] reaction smile** (#test)");
    expect(payload).toContain("リアクション本文");
  });
});
