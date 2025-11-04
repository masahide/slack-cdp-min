const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "medium",
});

const timestampFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "medium",
  timeStyle: "medium",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  timeStyle: "short",
});

export function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return dateFormatter.format(new Date(year, (month ?? 1) - 1, day));
}

export function formatIsoTimestamp(value: string): string {
  return timestampFormatter.format(new Date(value));
}

export function formatEventTime(value: string | null, fallbackDate?: string): string {
  if (value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return timeFormatter.format(new Date(parsed));
    }
  }
  if (fallbackDate) {
    const [year, month, day] = fallbackDate.split("-").map(Number);
    return timeFormatter.format(new Date(year, (month ?? 1) - 1, day));
  }
  return "--:--";
}
