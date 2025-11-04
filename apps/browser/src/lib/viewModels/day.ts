import type { TimelineEvent } from "$lib/server/types";

export interface DaySourceOption {
  name: string;
  count: number;
  selected: boolean;
}

export interface DayPageData {
  date: string;
  events: TimelineEvent[];
  summary: string | null;
  sources: DaySourceOption[];
}
