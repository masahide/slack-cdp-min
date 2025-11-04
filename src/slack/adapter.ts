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

const DEBUG_TOKENS = (process.env.REACLOG_DEBUG ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter((token) => token.length > 0);

const DEBUG_TARGETS = new Set(DEBUG_TOKENS);

export class SlackAdapter implements IngestionAdapter {
  name = "slack";
  private readonly now: () => Date;
  private readonly timezone: string;
  private emit: EmitFn | null = null;
  private readonly cache: Map<string, { text?: string; user?: string }> = new Map();
  private readonly seenUids: Set<string> = new Set();
  private readonly debugEnabled = DEBUG_TARGETS.has("slack") || DEBUG_TARGETS.has("slack:verbose");
  private readonly debugVerboseEnabled = DEBUG_TARGETS.has("slack:verbose");

  constructor(private readonly deps: SlackAdapterDeps) {
    this.now = deps.now ?? (() => new Date());
    this.timezone = deps.timezone ?? "Asia/Tokyo";
  }

  async start(emit: EmitFn): Promise<void> {
    this.emit = emit;
    const { Network, Fetch } = this.deps.client;

    await Network.enable({});
    await Network.setCacheDisabled({ cacheDisabled: true });
    this.debugVerbose("Network domain enabled");
    Network.on("webSocketFrameReceived", (payload) => {
      this.debugVerbose("webSocketFrameReceived", this.safePreview(payload));
      this.handleWebSocketFrame(payload as WebSocketFrameReceivedEvent);
    });
    Network.on("responseReceived", (payload) => {
      this.debugVerbose("responseReceived", this.safePreview(payload));
      void this.handleResponseReceived(payload as ResponseReceivedEvent);
    });

    await Fetch.enable({
      patterns: [
        { urlPattern: "*://*.slack.com/api/chat.postMessage*", requestStage: "Request" },
        { urlPattern: "*://*.slack.com/api/reactions.*", requestStage: "Request" },
      ],
    });
    this.debugVerbose("Fetch domain enabled with patterns");

    Fetch.on("requestPaused", async (event: FetchPausedEvent) => {
      this.debugVerbose("requestPaused", this.safePreview(event));
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
    const payload = this.parseBody(body, contentType);
    if (!payload) {
      this.debug("parseBody returned null", { url: event.request.url, contentType });
      return [];
    }

    this.debugVerbose("parsed payload", this.redactPayload(payload));

    if (url.pathname.endsWith("/api/chat.postMessage")) {
      const channelId = typeof payload.channel === "string" ? payload.channel : "";
      const userId = typeof payload.user === "string" ? payload.user : undefined;
      const blocks = payload.blocks as Parameters<typeof fromBlocks>[0];
      const rawTs = this.asString(payload.ts);
      const slackTs = this.resolveMessageTs(rawTs ?? this.asString(payload.thread_ts));
      const event = normalizeSlackMessage(
        {
          channel: { id: channelId, name: channelId },
          user: { id: userId ?? "unknown", name: userId },
          ts: slackTs,
          text: payload.text as string | undefined,
          blocks,
          thread_ts: payload.thread_ts as string | undefined,
          raw_ts: rawTs,
        },
        normalizeOpts
      );
      if (channelId) {
        this.cacheMessage(channelId, slackTs, {
          text: (payload.text as string | undefined) ?? fromBlocks(blocks),
          user: userId,
        });
        if (rawTs && rawTs !== slackTs) {
          this.cacheMessage(channelId, rawTs, {
            text: (payload.text as string | undefined) ?? fromBlocks(blocks),
            user: userId,
          });
        }
      }
      return [event];
    }

    if (url.pathname.startsWith("/api/reactions.")) {
      const item = payload.item as Record<string, unknown> | undefined;
      const channelId = this.asString(payload.channel) ?? this.asString(item?.channel) ?? "";
      const rawItemTs = this.asString(payload.timestamp) ?? this.asString(item?.ts);
      const normalizedItemTs = this.normalizedTimestamp(rawItemTs);
      const fallbackItemTs = this.resolveMessageTs(undefined);
      const lookupKeys = [rawItemTs, normalizedItemTs, fallbackItemTs]
        .filter((value): value is string => Boolean(value))
        .map((value) => this.cacheKey(channelId, value));
      const cached = lookupKeys
        .map((key) => this.cache.get(key))
        .find((entry): entry is { text?: string; user?: string } => Boolean(entry));
      const action = url.pathname.endsWith(".add")
        ? "added"
        : url.pathname.endsWith(".remove")
          ? "removed"
          : "added";
      const userId = this.asString(payload.user) ?? cached?.user ?? "unknown";
      const reactionName = this.asString(payload.name) ?? this.asString(payload.reaction);
      const eventTs = this.asString(payload.event_ts);
      const itemTsForEvent = rawItemTs ?? normalizedItemTs ?? fallbackItemTs;
      if (!channelId || !itemTsForEvent || !reactionName) {
        this.debug("reaction payload missing fields", {
          channelId,
          itemTs: itemTsForEvent,
          reactionName,
          payload: this.redactPayload(payload),
        });
        return [];
      }

      const messageText = cached?.text ?? this.asString(payload.message_text);
      const reactionEvent = normalizeSlackReaction(
        {
          channel: { id: channelId, name: channelId },
          user: {
            id: userId,
            name: cached?.user ?? userId,
          },
          item_ts: itemTsForEvent,
          action,
          reaction: reactionName,
          event_ts: eventTs,
          message_text: messageText,
        },
        normalizeOpts
      );
      return [reactionEvent];
    }

    return [];
  }

  private normalizeHeader(headers: Record<string, string> | undefined, key: string): string {
    if (!headers) return "";
    const direct = headers[key];
    if (direct) return direct;
    const lower = headers[key.toLowerCase()];
    if (lower) return lower;
    const upper = headers[key.toUpperCase()];
    if (upper) return upper;
    const target = key.toLowerCase();
    for (const [k, value] of Object.entries(headers)) {
      if (k.toLowerCase() === target) return value;
    }
    return "";
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
    const normalized = this.normalizedTimestamp(ts);
    if (normalized) return normalized;
    const now = this.now();
    const epochSeconds = Math.floor(now.getTime() / 1000);
    const millis = now.getMilliseconds();
    return `${epochSeconds}.${String(millis).padStart(3, "0")}000`;
  }

  private async deliver(event: NormalizedEvent, emit: EmitFn): Promise<void> {
    if (!event || !event.uid) return;
    if (this.seenUids.has(event.uid)) return;
    this.seenUids.add(event.uid);
    this.debugVerbose("deliver", event);
    await emit(event);
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
  }

  private normalizedTimestamp(ts: string | undefined): string | null {
    if (!ts) return null;
    const parsed = Number.parseFloat(ts);
    if (!Number.isFinite(parsed)) return null;
    const seconds = Math.floor(parsed);
    const micros = Math.round((parsed - seconds) * 1_000_000);
    return `${seconds}.${String(micros).padStart(6, "0")}`;
  }

  private redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const cloned: Record<string, unknown> = { ...payload };
    for (const key of Object.keys(cloned)) {
      if (typeof cloned[key] === "string" && /(token|cookie)/i.test(key)) {
        cloned[key] = "[redacted]";
      }
    }
    return cloned;
  }

  private parseBody(body: string, contentType: string): Record<string, unknown> | null {
    if (!body) return {};
    if (/application\/json|text\/json/i.test(contentType) || body.trim().startsWith("{")) {
      try {
        return JSON.parse(body);
      } catch {
        this.debug("failed to parse JSON body");
        return null;
      }
    }

    if (/application\/x-www-form-urlencoded/i.test(contentType)) {
      try {
        const params = new URLSearchParams(body);
        const result: Record<string, unknown> = {};
        for (const [key, value] of params.entries()) {
          result[key] = value;
          if (key === "payload") {
            try {
              const parsed = JSON.parse(value);
              Object.assign(result, parsed);
            } catch {
              this.debug("failed to parse nested payload JSON");
            }
          }
        }
        return result;
      } catch {
        this.debug("failed to parse form body");
        return null;
      }
    }

    if (/multipart\/form-data/i.test(contentType)) {
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      if (!boundaryMatch) {
        this.debug("missing multipart boundary");
        return null;
      }

      const boundary = `--${boundaryMatch[1].replace(/^["']|["']$/g, "")}`;
      const segments = body.split(boundary);
      const result: Record<string, unknown> = {};

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed || trimmed === "--") continue;

        const [headerSection, ...valueSections] = trimmed.split("\r\n\r\n");
        if (!headerSection || valueSections.length === 0) continue;

        const headers = headerSection.split("\r\n");
        const disposition = headers.find((line) => /content-disposition/i.test(line)) ?? "";
        const nameMatch = disposition.match(/name="([^"]+)"/i);
        if (!nameMatch) continue;

        let value = valueSections.join("\r\n\r\n");
        value = value.replace(/\r\n--$/, "");
        const normalizedValue = value.trim();

        result[nameMatch[1]] = normalizedValue;
        if (nameMatch[1] === "payload") {
          try {
            const parsed = JSON.parse(normalizedValue);
            Object.assign(result, parsed);
          } catch {
            this.debug("failed to parse multipart payload JSON");
          }
        }
      }

      return result;
    }

    return null;
  }

  private debug(message: string, payload?: unknown): void {
    if (!this.debugEnabled) return;
    if (payload === undefined) {
      console.log(`[SlackAdapter] ${message}`);
      return;
    }
    console.log(`[SlackAdapter] ${message}:`, payload);
  }

  private debugVerbose(message: string, payload?: unknown): void {
    if (!this.debugVerboseEnabled) return;
    this.debug(message, payload);
  }

  private safePreview(payload: unknown): unknown {
    if (!payload) return payload;
    try {
      return JSON.parse(
        JSON.stringify(payload, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      );
    } catch {
      return payload;
    }
  }
}
