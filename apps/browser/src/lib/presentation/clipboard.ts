import type { TimelineEvent } from "$lib/server/types";
import {
  classifyEventKind,
  getEventChannelLabel,
  getEventPresentation,
  getReactionEmoji,
} from "$lib/presentation/event";

export function buildClipboardPayload(
  date: string,
  events: TimelineEvent[],
  summary?: string | null
): string {
  const lines: string[] = [];
  lines.push(`# ReacLog ${date}`);

  if (summary && summary.trim().length > 0) {
    lines.push("", "## Summary", "");
    lines.push(summary.trim());
  }

  if (events.length > 0) {
    lines.push("", "## Events");
    for (const event of events) {
      lines.push(formatEventLine(event));
    }
  }

  return lines.join("\n");
}

function formatEventLine(event: TimelineEvent): string {
  const presentation = getEventPresentation(event);
  const channel = getEventChannelLabel(event);
  const actor = readString(event.raw as Record<string, unknown>, "actor");
  const subject = readString(event.raw as Record<string, unknown>, "subject") ?? event.uid;
  const kind = classifyEventKind(event);
  const emoji = getReactionEmoji(event);

  let header = `- **${subject}**`;
  if (channel) {
    header += ` (${channel})`;
  }
  if (kind === "reaction" && emoji) {
    header += ` — :${emoji}:`;
  } else if (actor) {
    header += ` — ${actor}`;
  }

  const text = presentation.text.trim();
  if (!text) {
    return header;
  }
  const indented = text.replace(/\r?\n/g, "\n  ");
  return `${header}\n  ${indented}`;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
