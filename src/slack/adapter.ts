import type { EmitFn, IngestionAdapter } from "../core/adapter.js";
import type { NormalizedEvent } from "../core/events.js";
import {
  normalizeSlackMessage,
  normalizeSlackReaction,
  type NormalizeOptions,
} from "./normalize.js";
import { fromBlocks } from "./blocks.js";

export type FetchPausedEvent = {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    postData?: string;
  };
};
export type WebSocketFrameReceivedEvent = {
  response: { payloadData: string };
};
export type ResponseReceivedEvent = {
  requestId: string;
  response: { url: string };
};

type SlackClient = {
  Fetch: {
    enable(opts: Record<string, unknown>): Promise<void>;
    on(name: "requestPaused", handler: (payload: FetchPausedEvent) => unknown): void;
    continueRequest(params: { requestId: string }): Promise<void>;
  };
  Network: {
    enable(opts: Record<string, unknown>): Promise<void>;
    setCacheDisabled(opts: { cacheDisabled: boolean }): Promise<void>;
    on(
      name: "webSocketFrameReceived" | "responseReceived",
      handler: (payload: WebSocketFrameReceivedEvent | ResponseReceivedEvent) => unknown
    ): void;
    getResponseBody(params: {
      requestId: string;
    }): Promise<{ body: string; base64Encoded: boolean }>;
  };
  Runtime: {
    evaluate(request: unknown): Promise<unknown>;
  };
};

type SlackAdapterDeps = {
  client: SlackClient;
  now?: () => Date;
  timezone?: string;
};

const SLACK_API_RE = /https:\/\/[^/]+\.slack\.com\/api\/(chat\.postMessage|reactions\.[a-z]+)/i;

export class SlackAdapter implements IngestionAdapter {
  name = "slack";
  private readonly now: () => Date;
  private readonly timezone: string;
  private emit: EmitFn | null = null;
  private readonly cache: Map<string, { text?: string; user?: string }> = new Map();
  private readonly seenUids: Set<string> = new Set();

  constructor(private readonly deps: SlackAdapterDeps) {
    this.now = deps.now ?? (() => new Date());
    this.timezone = deps.timezone ?? "Asia/Tokyo";
  }

  async start(emit: EmitFn): Promise<void> {
    this.emit = emit;
    const { Network, Fetch } = this.deps.client;

    await Network.enable({});
    await Network.setCacheDisabled({ cacheDisabled: true });
    Network.on("webSocketFrameReceived", (payload) => {
      this.handleWebSocketFrame(payload as WebSocketFrameReceivedEvent);
    });
    Network.on("responseReceived", (payload) => {
      void this.handleResponseReceived(payload as ResponseReceivedEvent);
    });

    await Fetch.enable({
      patterns: [
        { urlPattern: "*://*.slack.com/api/chat.postMessage*", requestStage: "Request" },
        { urlPattern: "*://*.slack.com/api/reactions.*", requestStage: "Request" },
      ],
    });

    Fetch.on("requestPaused", async (event: FetchPausedEvent) => {
      try {
        const normalizedEvents = await this.handleRequest(event);
        for (const normalized of normalizedEvents) {
          await this.deliver(normalized, emit);
        }
      } finally {
        await Fetch.continueRequest({ requestId: event.requestId });
      }
    });
  }

  async stop(): Promise<void> {
    this.emit = null;
  }

  private async handleRequest(event: FetchPausedEvent): Promise<NormalizedEvent[]> {
    if (event.request.method !== "POST") return [];
    if (!SLACK_API_RE.test(event.request.url)) return [];

    const body = event.request.postData ?? "";
    const contentType = this.normalizeHeader(event.request.headers, "content-type");
    const normalizeOpts: NormalizeOptions = { now: this.now(), timezone: this.timezone };
    const url = new URL(event.request.url);

    if (/application\/json|text\/json/i.test(contentType) || body.startsWith("{")) {
      try {
        const parsed = JSON.parse(body);
        if (url.pathname.endsWith("/api/chat.postMessage")) {
          const slackTs = this.resolveMessageTs(parsed.ts ?? parsed.thread_ts);
          const event = normalizeSlackMessage(
            {
              channel: { id: parsed.channel, name: parsed.channel },
              user: { id: parsed.user ?? "unknown", name: parsed.user ?? undefined },
              ts: slackTs,
              text: parsed.text,
              blocks: parsed.blocks,
              thread_ts: parsed.thread_ts,
            },
            normalizeOpts
          );
          this.cacheMessage(parsed.channel, slackTs, {
            text: parsed.text ?? fromBlocks(parsed.blocks),
            user: parsed.user,
          });
          return [event];
        }
        if (url.pathname.startsWith("/api/reactions.")) {
          const itemTs = parsed.timestamp ?? parsed.item?.ts ?? "";
          const cached = this.cache.get(this.cacheKey(parsed.channel, itemTs));
          const action = url.pathname.endsWith(".add")
            ? "added"
            : url.pathname.endsWith(".remove")
              ? "removed"
              : "added";
          const reactionEvent = normalizeSlackReaction(
            {
              channel: { id: parsed.channel, name: parsed.channel },
              user: {
                id: parsed.user ?? cached?.user ?? "unknown",
                name: parsed.user ?? cached?.user,
              },
              item_ts: itemTs,
              action,
              reaction: parsed.name ?? parsed.reaction,
              event_ts: parsed.event_ts,
            },
            normalizeOpts
          );
          return [reactionEvent];
        }
      } catch {
        return [];
      }
    }

    return [];
  }

  private normalizeHeader(headers: Record<string, string> | undefined, key: string): string {
    if (!headers) return "";
    const direct = headers[key];
    if (direct) return direct;
    const alt = headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
    return alt ?? "";
  }

  private handleWebSocketFrame(event: WebSocketFrameReceivedEvent): void {
    const payload = event.response.payloadData;
    if (!payload || payload.length > 512 * 1024) return;
    try {
      const data = JSON.parse(payload);
      if (data?.type === "message" && data.channel && data.ts) {
        const text = fromBlocks(data.blocks);
        this.cacheMessage(data.channel, data.ts, { text, user: data.user });
      } else if (data?.type === "message_changed" && data.channel && data.message?.ts) {
        const msg = data.message;
        const text = fromBlocks(msg.blocks);
        this.cacheMessage(data.channel, msg.ts, { text, user: msg.user });
      } else if (data?.type === "thread_broadcast" && data.channel && data.root_ts) {
        const text = fromBlocks(data.blocks);
        this.cacheMessage(data.channel, data.root_ts, { text, user: data.user });
      }
    } catch {
      /* ignore JSON parse errors */
    }
  }

  private async handleResponseReceived(event: ResponseReceivedEvent): Promise<void> {
    if (!SLACK_API_RE.test(event.response.url)) return;
    try {
      const { body, base64Encoded } = await this.deps.client.Network.getResponseBody({
        requestId: event.requestId,
      });
      const txt = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
      const data = JSON.parse(txt);
      const message = data?.message ?? data?.item;
      if (message?.channel && message?.ts) {
        const text = fromBlocks(message.blocks);
        this.cacheMessage(message.channel, message.ts, { text, user: message.user });
      }
    } catch {
      /* ignore errors */
    }
  }

  private cacheMessage(
    channel: string,
    ts: string,
    value: { text?: string | null; user?: string | null }
  ): void {
    if (!channel || !ts) return;
    this.cache.set(this.cacheKey(channel, ts), {
      text: value.text ?? undefined,
      user: value.user ?? undefined,
    });
  }

  private cacheKey(channel: string, ts: string): string {
    return `${channel}@${ts}`;
  }

  private resolveMessageTs(ts: string | undefined): string {
    if (ts && ts !== "") return ts;
    const now = this.now();
    const epochSeconds = Math.floor(now.getTime() / 1000);
    const millis = now.getMilliseconds();
    return `${epochSeconds}.${String(millis).padStart(3, "0")}000`;
  }

  private async deliver(event: NormalizedEvent, emit: EmitFn): Promise<void> {
    if (!event || !event.uid) return;
    if (this.seenUids.has(event.uid)) return;
    this.seenUids.add(event.uid);
    await emit(event);
  }
}
