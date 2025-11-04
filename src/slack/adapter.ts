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
  frameId?: string;
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
    enable(params: unknown): Promise<void>;
    on(
      name: "executionContextCreated" | "executionContextDestroyed",
      handler: (payload: unknown) => void
    ): void;
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

type SlackRepliesResponse = {
  ok: boolean;
  messages?: Array<{
    ts?: string;
    text?: string;
    user?: string;
    blocks?: unknown;
  }>;
};

type ExecutionContextDescription = {
  id: number;
  name: string;
  origin?: string;
  auxData?: {
    frameId?: string;
    type?: string;
    isDefault?: boolean;
  };
};

type RuntimeExecutionContextCreatedEvent = {
  context: ExecutionContextDescription;
};

type RuntimeExecutionContextDestroyedEvent = {
  executionContextId: number;
};

type FrameContextInfo = {
  default?: number;
  isolated?: number;
  other: number[];
};

export class SlackAdapter implements IngestionAdapter {
  name = "slack";
  private readonly now: () => Date;
  private readonly timezone: string;
  private emit: EmitFn | null = null;
  private readonly cache: Map<string, { text?: string; user?: string }> = new Map();
  private readonly seenUids: Set<string> = new Set();
  private readonly debugEnabled = DEBUG_TARGETS.has("slack") || DEBUG_TARGETS.has("slack:verbose");
  private readonly debugVerboseEnabled = DEBUG_TARGETS.has("slack:verbose");
  private apiToken: string | null = null;
  private readonly contextsByFrame: Map<string, FrameContextInfo> = new Map();
  private readonly frameIdByContext: Map<number, string | null> = new Map();
  private defaultContextId: number | null = null;

  constructor(private readonly deps: SlackAdapterDeps) {
    this.now = deps.now ?? (() => new Date());
    this.timezone = deps.timezone ?? "Asia/Tokyo";
  }

  async start(emit: EmitFn): Promise<void> {
    this.emit = emit;
    const { Network, Fetch, Runtime } = this.deps.client;

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
    await this.ensureApiToken();

    if (typeof Runtime.on === "function") {
      Runtime.on("executionContextCreated", (payload) => {
        this.handleExecutionContextCreated(payload as RuntimeExecutionContextCreatedEvent);
      });
      Runtime.on("executionContextDestroyed", (payload) => {
        this.handleExecutionContextDestroyed(payload as RuntimeExecutionContextDestroyedEvent);
      });
    }
    if (typeof Runtime.enable === "function") {
      await Runtime.enable({});
    this.debugVerbose("Runtime domain enabled");
  }

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

    this.rememberToken({ payload, body, headers: event.request.headers });

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

      const fetched =
        cached ??
        (await this.fetchMessageFromRuntime({
          channelId,
          ts: itemTsForEvent,
          frameId: event.frameId,
        }));
      if (fetched && (fetched.text || fetched.user)) {
        this.cacheMessage(channelId, itemTsForEvent, {
          text: fetched.text,
          user: fetched.user,
        });
      }
      const messageText =
        fetched?.text ??
        this.asString(payload.message_text) ??
        (await this.inflateMessage(channelId, itemTsForEvent, event.frameId));
      const messageUser =
        fetched?.user ?? cached?.user ?? this.asString(payload.message_user) ?? undefined;

      const reactionEvent = normalizeSlackReaction(
        {
          channel: { id: channelId, name: channelId },
          user: {
            id: userId,
            name: messageUser ?? userId,
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

  private async fetchMessageFromRuntime(params: {
    channelId: string;
    ts: string;
    frameId?: string;
    attempt?: number;
  }): Promise<{ text?: string; user?: string } | null> {
    const attempt = params.attempt ?? 0;
    this.debugVerbose("fetchMessageFromRuntime call", params);
    const expression = `(() => {
        try {
          const channelId = ${JSON.stringify(params.channelId)};
          const targetTs = ${JSON.stringify(params.ts)};
          const store = window.TS?.client?.channel_store;
          const channel = store?.getChannel?.(channelId);
          const fromChannel = Array.isArray(channel?.messages)
            ? channel.messages.find((m) => m?.ts === targetTs)
            : null;
          if (fromChannel) {
            return {
              text: fromChannel.text ?? null,
              user: fromChannel.user ?? null,
              blocks: fromChannel.blocks ?? null,
            };
          }
          const cache = window.TS?.model?.messages?.[channelId];
          if (Array.isArray(cache)) {
            const match = cache.find((m) => m?.ts === targetTs);
            if (match) {
              return {
                text: match.text ?? null,
                user: match.user ?? null,
                blocks: match.blocks ?? null,
              };
            }
          }
        } catch {}
        return null;
      })()`;

    for (const contextId of this.resolveContextIds(params.frameId)) {
      try {
        const evalParams: Record<string, unknown> = {
          expression,
          returnByValue: true,
        };
        if (contextId !== null) evalParams.contextId = contextId;
        const result = (await this.deps.client.Runtime.evaluate(evalParams)) as {
          result?: { value?: unknown };
        };
        const value = result?.result?.value;
        this.debugVerbose("fetchMessageFromRuntime result", {
          contextId,
          value: this.safePreview(value),
        });
        if (!value || typeof value !== "object") continue;
        const text = this.asString((value as Record<string, unknown>).text);
        const user = this.asString((value as Record<string, unknown>).user);
        const blocks = (value as Record<string, unknown>).blocks;
        if (text || blocks || user) {
          return {
            text: text ?? fromBlocks(blocks),
            user: user ?? undefined,
          };
        }
      } catch (err) {
        this.debugVerbose("fetchMessageFromRuntime context error", {
          contextId,
          error: this.safePreview(err),
        });
      }
    }

    if (attempt >= 1) return null;

    const fetched = await this.fetchMessageViaChannelView({
      channelId: params.channelId,
      ts: params.ts,
      frameId: params.frameId,
    });

    if (fetched && (fetched.text || fetched.user)) {
      this.cacheMessage(params.channelId, params.ts, fetched);
    }

    const retry = await this.fetchMessageFromRuntime({
      channelId: params.channelId,
      ts: params.ts,
      frameId: params.frameId,
      attempt: attempt + 1,
    });

    return retry ?? fetched ?? null;
  }

  private async inflateMessage(
    channelId: string,
    ts: string,
    frameId?: string
  ): Promise<string | undefined> {
    const fetched = await this.fetchMessageViaChannelView({ channelId, ts, frameId });
    if (fetched && (fetched.text || fetched.user)) {
      this.cacheMessage(channelId, ts, fetched);
    }
    return fetched?.text;
  }

  private async fetchMessageViaChannelView(params: {
    channelId: string;
    ts: string;
    frameId?: string;
  }): Promise<{ text?: string; user?: string } | null> {
    try {
      this.debugVerbose("fetchMessageViaChannelView call", params);
      const expression = `(async () => {
        try {
          const channelId = ${JSON.stringify(params.channelId)};
          const targetTs = ${JSON.stringify(params.ts)};
          const tsKeys = Object.keys(window.TS ?? {}).slice(0, 20);
          const tsProps = Object.getOwnPropertyNames(window.TS ?? {}).slice(0, 20);
          const clientKeys = Object.keys(window.TS?.client ?? {}).slice(0, 20);
          const clientProps = Object.getOwnPropertyNames(window.TS?.client ?? {}).slice(0, 20);
          const modelKeys = Object.keys(window.TS?.model ?? {}).slice(0, 20);
          const windowProps = Object.getOwnPropertyNames(window);
          const sampledWindowProps = windowProps.slice(0, 60);
          const candidateNames = windowProps
            .filter((name) =>
              /store|Store|channel|messages|Model|Cache|TS/i.test(name)
            )
            .slice(0, 30);
          const channelView = window.TS?.client?.channel_view;
          const tsType = typeof window.TS;
          let tsKeySample: string[] | null = null;
          try {
            if (window.TS && typeof window.TS === "object") {
              tsKeySample = Object.keys(window.TS).slice(0, 30);
            }
          } catch {}
          const hasDocument = typeof document !== "undefined";
          const hasTSObject = typeof window.TS !== "undefined";
          const sharedContext = {
            clientKeys,
            clientProps,
            tsKeys,
            tsProps,
            modelKeys,
            windowPropsSample: sampledWindowProps,
            windowPropsCount: windowProps.length,
            candidateNames,
            candidateCount: candidateNames.length,
            tsType,
            tsKeySample,
            hasDocument,
            hasTSObject,
          };
          const toPayload = (value, source) => {
            if (!value || typeof value !== "object") return null;
            return {
              text: value.text ?? null,
              user: value.user ?? null,
              blocks: value.blocks ?? null,
              source,
            };
          };
          const isSkippableObject = (value) => {
            if (!value) return true;
            if (typeof value !== "object") return true;
            if (value === window || value === document) return true;
            if (typeof value.nodeType === "number") return true;
            return false;
          };
          const searchMessageInStores = () => {
            const maxNodes = 2500;
            const maxChildren = 60;
            const visited = new Set();
            const queue = [];
            const seenPaths = [];
            const push = (value, path) => {
              if (isSkippableObject(value)) return;
              if (visited.has(value)) return;
              visited.add(value);
              queue.push({ value, path });
              if (seenPaths.length < 10) seenPaths.push(path.join("."));
            };
            push(window.TS?.model, ["TS", "model"]);
            push(window.TS?.client, ["TS", "client"]);
            push(window.TS?.app, ["TS", "app"]);
            push(window.TS?.reduxStore, ["TS", "reduxStore"]);
            push(window.TS?.workspace, ["TS", "workspace"]);
            for (const name of candidateNames) {
              try {
                push(window[name], [name]);
              } catch {}
            }
            let processed = 0;
            while (queue.length && processed < maxNodes) {
              const { value, path } = queue.shift();
              if (!value) continue;
              processed += 1;
              if (Array.isArray(value)) {
                const length = Math.min(value.length, maxChildren);
                for (let index = 0; index < length; index += 1) {
                  const item = value[index];
                  if (!item) continue;
                  if (typeof item === "object" && item.ts === targetTs) {
                    const locatedPath = path.concat("[" + index + "]");
                    return {
                      payload: toPayload(item, locatedPath.join(".")),
                      meta: { path: locatedPath },
                    };
                  }
                  push(item, path.concat("[" + index + "]"));
                }
                continue;
              }
              const tag = Object.prototype.toString.call(value);
              if (tag === "[object Map]") {
                let count = 0;
                for (const [mapKey, mapValue] of value) {
                  if (count >= maxChildren) break;
                  count += 1;
                  if (!mapValue) continue;
                  const childPath = path.concat("(map:" + String(mapKey) + ")");
                  if (typeof mapValue === "object" && mapValue.ts === targetTs) {
                    return {
                      payload: toPayload(mapValue, childPath.join(".")),
                      meta: { path: childPath },
                    };
                  }
                  push(mapValue, childPath);
                }
                continue;
              }
              if (tag === "[object Set]") {
                let count = 0;
                for (const setValue of value) {
                  if (count >= maxChildren) break;
                  count += 1;
                  if (!setValue) continue;
                  const childPath = path.concat("(set)");
                  if (typeof setValue === "object" && setValue.ts === targetTs) {
                    return {
                      payload: toPayload(setValue, childPath.join(".")),
                      meta: { path: childPath },
                    };
                  }
                  push(setValue, childPath);
                }
                continue;
              }
              const keys = [];
              try {
                keys.push(...Reflect.ownKeys(value));
              } catch {}
              const limitedKeys = keys.slice(0, maxChildren);
              for (const rawKey of limitedKeys) {
                if (typeof rawKey !== "string" && typeof rawKey !== "number") continue;
                let child;
                try {
                  child = value[rawKey];
                } catch {
                  continue;
                }
                if (!child) continue;
                const childPath = path.concat(String(rawKey));
                if (typeof child === "object" && child.ts === targetTs) {
                  return {
                    payload: toPayload(child, childPath.join(".")),
                    meta: { path: childPath },
                  };
                }
                push(child, childPath);
              }
            }
            return {
              meta: {
                processed,
                visited: visited.size,
                sampledPaths: seenPaths,
              },
            };
          };
          if (!channelView || typeof channelView !== "object") {
            const scanned = searchMessageInStores();
            if (scanned?.payload) {
              return scanned.payload;
            }
            return { status: "no-channel-view", scanned: scanned?.meta ?? null, ...sharedContext };
          }
          const keys = Object.keys(channelView.channel_views ?? {}).slice(0, 15);
          if (typeof channelView.fetchMessage === "function") {
            try {
              const result = await channelView.fetchMessage(channelId, targetTs);
              const payload = toPayload(result, "channel_view.fetchMessage");
              if (payload) return payload;
            } catch (err) {
              return {
                status: "error",
                source: "channel_view.fetchMessage",
                error: String(err),
                keys,
                ...sharedContext,
              };
            }
          }
          const view = channelView.channel_views?.[channelId];
          if (view && typeof view.fetchMessage === "function") {
            try {
              const result = await view.fetchMessage(targetTs);
              const payload = toPayload(result, "channel_views[channelId].fetchMessage");
              if (payload) return payload;
            } catch (err) {
              return {
                status: "error",
                source: "channel_views[channelId].fetchMessage",
                error: String(err),
                keys,
                ...sharedContext,
              };
            }
          }
          const scanned = searchMessageInStores();
          if (scanned?.payload) {
            return scanned.payload;
          }
          return {
            status: "miss",
            keys,
            scanned: scanned?.meta ?? null,
            ...sharedContext,
          };
        } catch (err) {
          return {
            status: "error",
            error: String(err),
            clientKeys: Object.keys(window.TS?.client ?? {}).slice(0, 20),
            clientProps: Object.getOwnPropertyNames(window.TS?.client ?? {}).slice(0, 20),
            tsKeys: Object.keys(window.TS ?? {}).slice(0, 20),
            tsProps: Object.getOwnPropertyNames(window.TS ?? {}).slice(0, 20),
            modelKeys: Object.keys(window.TS?.model ?? {}).slice(0, 20),
            windowProps: Object.getOwnPropertyNames(window).slice(0, 60),
            candidateNames: Object.getOwnPropertyNames(window)
              .filter((name) => /store|Store|channel|messages|Model|Cache/i.test(name))
              .slice(0, 30),
            windowPropsSample: Object.getOwnPropertyNames(window).slice(0, 60),
            windowPropsCount: Object.getOwnPropertyNames(window).length,
            candidateCount: Object.getOwnPropertyNames(window).filter((name) =>
              /store|Store|channel|messages|Model|Cache/i.test(name)
            ).length,
          };
        }
      })()`;
      const contextCandidates = this.resolveContextIds(params.frameId);
      for (const contextId of contextCandidates) {
        try {
          const evalParams: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise: true,
          };
          if (contextId !== null) evalParams.contextId = contextId;
          const evalResult = (await this.deps.client.Runtime.evaluate(evalParams)) as {
            result?: { value?: unknown };
          };
          const value = evalResult?.result?.value;
          this.debugVerbose("fetchMessageViaChannelView result", {
            contextId,
            value: this.safePreview(value),
          });
          if (!value || typeof value !== "object") continue;
          if ("status" in value && (value as { status?: string }).status !== undefined) {
            continue;
          }
          const text = this.asString((value as Record<string, unknown>).text);
          const user = this.asString((value as Record<string, unknown>).user);
          const blocks = (value as Record<string, unknown>).blocks;
          if (text || blocks || user) {
            return {
              text: text ?? fromBlocks(blocks),
              user: user ?? undefined,
            };
          }
        } catch (err) {
          this.debugVerbose("fetchMessageViaChannelView context error", {
            contextId,
            error: this.safePreview(err),
          });
        }
      }
      return null;
    } catch (err) {
      this.debugVerbose("fetchMessageViaChannelView exception", err);
      return null;
    }
  }

  private handleExecutionContextCreated(event: RuntimeExecutionContextCreatedEvent): void {
    try {
      const context = event?.context;
      if (!context || typeof context.id !== "number") return;
      this.debugVerbose("executionContextCreated", {
        id: context.id,
        name: context.name,
        origin: context.origin,
        auxData: context.auxData,
      });
      const frameId = context.auxData?.frameId ?? null;
      const type = context.auxData?.type;
      const isDefault = Boolean(context.auxData?.isDefault || type === "default");
      if (frameId) {
        const info: FrameContextInfo = this.contextsByFrame.get(frameId) ?? { other: [] };
        if (isDefault) {
          info.default = context.id;
          this.defaultContextId = context.id;
        } else if (type === "isolated") {
          info.isolated = context.id;
        } else {
          if (!info.other.includes(context.id)) info.other.push(context.id);
        }
        this.contextsByFrame.set(frameId, info);
      } else if (isDefault) {
        this.defaultContextId = context.id;
      }
      this.frameIdByContext.set(context.id, frameId);
    } catch (err) {
      this.debugVerbose("executionContextCreated error", err);
    }
  }

  private handleExecutionContextDestroyed(event: RuntimeExecutionContextDestroyedEvent): void {
    try {
      const contextId = event?.executionContextId;
      if (typeof contextId !== "number") return;
      const frameId = this.frameIdByContext.get(contextId);
      if (frameId) {
        const info = this.contextsByFrame.get(frameId);
        if (info) {
          if (info.default === contextId) delete info.default;
          if (info.isolated === contextId) delete info.isolated;
          info.other = info.other.filter((id) => id !== contextId);
          if (!info.default && !info.isolated && info.other.length === 0) {
            this.contextsByFrame.delete(frameId);
          } else {
            this.contextsByFrame.set(frameId, info);
          }
        }
      }
      this.frameIdByContext.delete(contextId);
      if (this.defaultContextId === contextId) {
        this.defaultContextId = null;
      }
    } catch (err) {
      this.debugVerbose("executionContextDestroyed error", err);
    }
  }

  private resolveContextIds(frameId?: string): Array<number | null> {
    const result: number[] = [];
    if (frameId) {
      const info = this.contextsByFrame.get(frameId);
      if (info) {
        if (typeof info.default === "number") result.push(info.default);
        if (typeof info.isolated === "number") {
          if (!result.includes(info.isolated)) result.push(info.isolated);
        }
        for (const id of info.other) {
          if (!result.includes(id)) result.push(id);
        }
      }
    }
    if (this.defaultContextId !== null && !result.includes(this.defaultContextId)) {
      result.push(this.defaultContextId);
    }
    result.push(null);
    return result;
  }

  private async resolveApiToken(): Promise<string | null> {
    if (this.apiToken) return this.apiToken;
    try {
      const expression = `(() => {
        try {
          if (typeof window !== "object") return null;
          if (window.__REACLOG_API_TOKEN) return window.__REACLOG_API_TOKEN;
          const boot = window.TS?.boot_data;
          if (boot?.api_token) {
            window.__REACLOG_API_TOKEN = boot.api_token;
            return window.__REACLOG_API_TOKEN;
          }
          if (typeof window.SetApiToken === "function") {
            const token = window.SetApiToken();
            if (token) {
              window.__REACLOG_API_TOKEN = token;
              return token;
            }
          }
        } catch {}
        return null;
      })()`;
      const result = (await this.deps.client.Runtime.evaluate({
        expression,
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      const token = this.asString(result?.result?.value as string | undefined);
      this.debugVerbose("resolveApiToken Runtime result", token ?? "<missing>");
      if (token) this.apiToken = token;
      return token ?? null;
    } catch (err) {
      this.debugVerbose("resolveApiToken failed", err);
      return null;
    }
  }

  private async fetchMessageDetails(params: {
    token?: string;
    channelId: string;
    ts: string;
  }): Promise<{ text?: string; user?: string } | null> {
    const { token, channelId, ts } = params;
    if (!token) return null;
    try {
      const body = new URLSearchParams({
        channel: channelId,
        ts,
        inclusive: "true",
        limit: "1",
      });
      this.debugVerbose("calling conversations.replies", { channelId, ts });
      const response = await fetch("https://slack.com/api/conversations.replies", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      this.debugVerbose("conversations.replies status", response.status);
      if (!response.ok) return null;
      const data = (await response.json()) as SlackRepliesResponse;
      this.debugVerbose("conversations.replies body", this.safePreview(data));
      if (!data.ok || !Array.isArray(data.messages)) return null;
      const message = data.messages.find((m) => m.ts === ts) ?? data.messages[0];
      if (!message) return null;
      const text = this.asString(message.text) ?? fromBlocks(message.blocks);
      const user = this.asString(message.user);
      return { text: text ?? undefined, user: user ?? undefined };
    } catch {
      return null;
    }
  }

  private rememberToken(params: {
    payload: Record<string, unknown>;
    body: string;
    headers?: Record<string, string>;
  }): void {
    if (this.apiToken) return;
    const direct = this.asString(params.payload.token);
    if (direct) {
      this.debugVerbose("token from payload", "***redacted***");
      this.apiToken = direct;
      return;
    }

    const fromBody = this.extractTokenFromBody(params.body);
    if (fromBody) {
      this.debugVerbose("token from body", "***redacted***");
      this.apiToken = fromBody;
      return;
    }

    const fromHeaders = this.extractTokenFromHeaders(params.headers);
    if (fromHeaders) {
      this.debugVerbose("token from headers", "***redacted***");
      this.apiToken = fromHeaders;
    }
  }

  private extractTokenFromBody(body: string): string | null {
    if (!body) return null;
    try {
      const params = new URLSearchParams(body);
      const token = params.get("token");
      return token ?? null;
    } catch {
      return null;
    }
  }

  private extractTokenFromHeaders(headers?: Record<string, string>): string | null {
    if (!headers) return null;
    const auth = headers.Authorization ?? headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.replace("Bearer ", "");
    return null;
  }

  private async ensureApiToken(): Promise<void> {
    if (this.apiToken) return;
    try {
      const expression = `(() => {
        try {
          if (typeof window !== "object") return null;
          const existing = window.__REACLOG_API_TOKEN;
          if (existing) return existing;
          const boot = window.TS?.boot_data;
          if (boot?.api_token) {
            window.__REACLOG_API_TOKEN = boot.api_token;
            return boot.api_token;
          }
          const weakKey = "SetApiToken?token=";
          const getter = window[weakKey];
          if (typeof getter === "function") {
            const token = getter();
            if (token) {
              window.__REACLOG_API_TOKEN = token;
              return token;
            }
          }
        } catch {
          // ignore
        }
        return null;
      })()`;
      const result = (await this.deps.client.Runtime.evaluate({
        expression,
        returnByValue: true,
      })) as { result?: { value?: unknown } };
      const token = this.asString(result?.result?.value as string | undefined);
      if (token) this.apiToken = token;
    } catch {
      /* ignore */
    }
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
