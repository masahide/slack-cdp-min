import type {
  FetchPausedEvent,
  ResponseReceivedEvent,
  WebSocketFrameReceivedEvent,
} from "../src/slack/adapter.js";

export type Triggerable = {
  fetchHandlers: { requestPaused?: (payload: FetchPausedEvent) => unknown };
  networkHandlers: {
    webSocketFrameReceived?: (payload: WebSocketFrameReceivedEvent) => unknown;
    responseReceived?: (payload: ResponseReceivedEvent) => unknown;
  };
  triggerFetch(payload: FetchPausedEvent): Promise<void>;
  triggerNetwork(
    name: "webSocketFrameReceived" | "responseReceived",
    payload: WebSocketFrameReceivedEvent | ResponseReceivedEvent
  ): Promise<void>;
};

export const createMockSlackClient = () => {
  const fetchHandlers: { requestPaused?: (payload: FetchPausedEvent) => unknown } = {};
  const networkHandlers: {
    webSocketFrameReceived?: (payload: WebSocketFrameReceivedEvent) => unknown;
    responseReceived?: (payload: ResponseReceivedEvent) => unknown;
  } = {};
  const calls: string[] = [];
  const continued: string[] = [];

  const responseBodies: Record<string, { body: string; base64Encoded: boolean }> = {};

  const client = {
    Fetch: {
      enable: async (opts: unknown) => {
        calls.push(`Fetch.enable:${JSON.stringify(opts)}`);
      },
      on(name: "requestPaused", handler: (payload: FetchPausedEvent) => unknown) {
        fetchHandlers.requestPaused = handler;
      },
      continueRequest: async ({ requestId }: { requestId: string }) => {
        continued.push(requestId);
      },
    },
    Network: {
      enable: async (opts: unknown) => {
        calls.push(`Network.enable:${JSON.stringify(opts)}`);
      },
      setCacheDisabled: async (opts: unknown) => {
        calls.push(`Network.setCacheDisabled:${JSON.stringify(opts)}`);
      },
      on(
        name: "webSocketFrameReceived" | "responseReceived",
        handler: (payload: WebSocketFrameReceivedEvent | ResponseReceivedEvent) => unknown
      ) {
        if (name === "webSocketFrameReceived") {
          networkHandlers.webSocketFrameReceived = handler as (
            payload: WebSocketFrameReceivedEvent
          ) => unknown;
        } else {
          networkHandlers.responseReceived = handler as (payload: ResponseReceivedEvent) => unknown;
        }
      },
      getResponseBody: async ({ requestId }: { requestId: string }) =>
        responseBodies[requestId] ?? { body: "", base64Encoded: false },
    },
    Runtime: {
      evaluate: async () => ({ result: { value: null } }),
    },
  };

  return {
    client,
    calls,
    continued,
    fetchHandlers,
    networkHandlers,
    responseBodies,
    async triggerFetch(payload: FetchPausedEvent) {
      const handler = fetchHandlers.requestPaused;
      if (handler) await handler(payload);
    },
    async triggerNetwork(
      name: "webSocketFrameReceived" | "responseReceived",
      payload: WebSocketFrameReceivedEvent | ResponseReceivedEvent
    ) {
      if (name === "webSocketFrameReceived") {
        const handler = networkHandlers.webSocketFrameReceived;
        if (handler) await handler(payload as WebSocketFrameReceivedEvent);
      } else {
        const handler = networkHandlers.responseReceived;
        if (handler) await handler(payload as ResponseReceivedEvent);
      }
    },
  };
};

export type MockSlackClient = ReturnType<typeof createMockSlackClient>;
