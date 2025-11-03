import CDP from "chrome-remote-interface";

const HOST = process.env.CDP_HOST || "127.0.0.1";
const PORT = Number(process.env.CDP_PORT || 9222);

const SLACK_API_RE = /https:\/\/[^/]+\.slack\.com\/api\/(chat\.postMessage|reactions\.[a-z]+)/i;
const SLACK_APP_RE = /https:\/\/app\.slack\.com/i;

type MsgCache = Map<string, { text?: string; user?: string }>;
const cache: MsgCache = new Map();
const key = (channel: string, ts: string) => `${channel}@${ts}`;


// ★ 追加：必要最小限のローカル型
type WSFrameEvt = { response: { payloadData: string } };
type FetchPausedEvt = {
    requestId: string;
    request: {
        url: string;
        method: string;
        postData?: string;
        headers?: Record<string, string>;
    };
};
type RespReceivedEvt = {
    requestId: string;
    response: { url: string };
};

// ---- Slack の Page ターゲットを列挙から見つける（sessionId 不要の方式）
async function connectToSlackPage() {
    // ブラウザの全ターゲットを取得
    const targets = await CDP.List({ host: HOST, port: PORT });
    const page = targets.find(
        (t) =>
            (t.type === "page" || t.type === "webview" || t.type === "other") &&
            SLACK_APP_RE.test(t.url || "")
    );
    if (!page) throw new Error("Slack page target not found. Open app.slack.com in the desktop app.");
    // Page ターゲットへ直接接続（← これなら sessionId を意識しなくて良い）
    const client = await CDP({ host: HOST, port: PORT, target: page });
    return { client, slackUrl: page.url! };
}

async function main() {
    const { client, slackUrl } = await connectToSlackPage();
    console.log("[ReacLog] attached to:", slackUrl);

    const { Network, Fetch } = client;

    // --- WSで流れるメッセージをキャッシュ（②段目フォールバック）
    await Network.enable({});
    await Network.setCacheDisabled({ cacheDisabled: true });

    Network.webSocketFrameReceived((e: WSFrameEvt) => {
        try {
            const payload = e.response.payloadData;
            if (!payload || payload.length > 512 * 1024) return;
            const d = JSON.parse(payload);
            if (d?.type === "message" && d.channel && d.ts) {
                const text = fromBlocks(d.blocks);
                cache.set(key(d.channel, d.ts), { text, user: d.user });
            } else if (d?.type === "message_changed" && d.channel && d.message?.ts) {
                const m = d.message;
                const text = fromBlocks(m.blocks);
                cache.set(key(d.channel, m.ts), { text, user: m.user });
            } else if (d?.type === "thread_broadcast" && d.channel && d.root_ts) {
                const text = fromBlocks(d.blocks);
                cache.set(key(d.channel, d.root_ts), { text, user: d.user });
            }
        } catch {
            /* noop */
        }
    });

    // --- Fetch で POST をインターセプトして postData を取得（①段目）
    await Fetch.enable({
        patterns: [
            { urlPattern: "*://*.slack.com/api/chat.postMessage*", requestStage: "Request" },
            { urlPattern: "*://*.slack.com/api/reactions.*", requestStage: "Request" },
        ],
    });

    Fetch.requestPaused(async (e: FetchPausedEvt) => {
        const url = e.request.url;
        if (SLACK_API_RE.test(url) && e.request.method === "POST") {
            const now = new Date().toLocaleString();

            const ct = e.request.headers?.["content-type"] || e.request.headers?.["Content-Type"] || "";
            const raw = e.request.postData ?? ""; // CRI 0.33系ではこれだけで十分
            console.log(`\n[POST] ${now}  ${url}`);
            console.log("  content-type:", ct || "(unknown)", "postData.length:", raw.length);

            const u = new URL(url);
            const isPost = u.pathname.endsWith("/api/chat.postMessage");
            const isReact = u.pathname.startsWith("/api/reactions.");
            const reactionType: "add" | "remove" | undefined = u.pathname.endsWith("/api/reactions.add")
                ? "add"
                : u.pathname.endsWith("/api/reactions.remove")
                    ? "remove"
                    : undefined;

            let channel = "",
                ts = "",
                text = "",
                emoji = "";

            // multipart/form-data
            const mm = /multipart\/form-data;\s*boundary=([-\w]+)/i.exec(ct);
            if (mm) {
                const fields = parseMultipart(raw, mm[1]);
                if (isPost) {
                    channel = fields["channel"] ?? "";
                    ts = fields["ts"] ?? fields["thread_ts"] ?? "";
                    text = fields["text"] ?? fromBlocks(fields["blocks"]);
                    console.log("  kind=post", { channel, ts, text });
                } else if (isReact) {
                    channel = fields["channel"] ?? "";
                    ts = fields["timestamp"] ?? "";
                    emoji = fields["name"] ?? "";
                    console.log("  kind=reaction", { type: reactionType, channel, ts, emoji });
                    const c = cache.get(key(channel, ts));
                    if (c?.text || c?.user)
                        console.log("  ↳ message cached:", { text: c.text, user: c.user });
                }
            }
            // application/x-www-form-urlencoded
            else if (/application\/x-www-form-urlencoded/i.test(ct) || raw.includes("=")) {
                const p = new URLSearchParams(raw);
                if (isPost) {
                    channel = p.get("channel") ?? "";
                    ts = p.get("ts") ?? p.get("thread_ts") ?? "";
                    text = p.get("text") ?? fromBlocks(p.get("blocks"));
                    console.log("  kind=post", { channel, ts, text });
                } else if (isReact) {
                    channel = p.get("channel") ?? "";
                    ts = p.get("timestamp") ?? "";
                    emoji = p.get("name") ?? "";
                    console.log("  kind=reaction", { type: reactionType, channel, ts, emoji });
                    const c = cache.get(key(channel, ts));
                    if (c?.text || c?.user)
                        console.log("  ↳ message cached:", { text: c.text, user: c.user });
                }
            }
            // application/json
            else if (/application\/json|text\/json/i.test(ct) || raw.startsWith("{")) {
                try {
                    const j = JSON.parse(raw);
                    if (isPost) {
                        channel = j.channel ?? "";
                        ts = j.ts ?? j.thread_ts ?? "";
                        text = j.text ?? fromBlocks(j.blocks);
                        console.log("  kind=post", { channel, ts, text });
                    } else if (isReact) {
                        channel = j.channel ?? "";
                        ts = j.timestamp ?? "";
                        emoji = j.name ?? "";
                        console.log("  kind=reaction", { type: reactionType, channel, ts, emoji });
                        const c = cache.get(key(channel, ts));
                        if (c?.text || c?.user)
                            console.log("  ↳ message cached:", { text: c.text, user: c.user });
                    }
                } catch {
                    /* noop */
                }
            } else {
                console.log("  (unknown content-type; cannot parse body)");
            }
        }
        await Fetch.continueRequest({ requestId: e.requestId });
    });

    // --- ③段目：レスポンス本文から message を拾えるならキャッシュ
    Network.responseReceived(async (e: RespReceivedEvt) => {
        if (!SLACK_API_RE.test(e.response.url)) return;
        try {
            const { body, base64Encoded } = await Network.getResponseBody({ requestId: e.requestId });
            const txt = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
            const json = JSON.parse(txt);
            const msg = json?.message ?? json?.item?.message;
            if (msg?.channel && (msg?.ts || msg?.message_ts)) {
                const ts = msg.ts ?? msg.message_ts;
                const val = { text: msg.text ?? fromBlocks(msg.blocks), user: msg.user };
                cache.set(key(msg.channel, ts), val);
                console.log("  ↳ response message:", { channel: msg.channel, ts, text: val.text });
            }
        } catch {
            // 圧縮や非JSONはスキップ
        }
    });

    process.on("SIGINT", async () => {
        console.log("\n[ReacLog] closing…");
        await client.close();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

// ---------- helpers ----------
function parseMultipart(raw: string, boundary: string): Record<string, string> {
    const out: Record<string, string> = {};
    const delim = `--${boundary}`;
    const parts = raw.split(delim).slice(1, -1); // 先頭と終端(--)を除外
    for (const part of parts) {
        const idx = part.indexOf("\r\n\r\n");
        if (idx < 0) continue;
        const headerText = part.slice(0, idx);
        const body = part.slice(idx + 4).replace(/\r\n$/, ""); // trailing \r\n を除去
        const m = /name="([^"]+)"/i.exec(headerText);
        if (!m) continue;
        out[m[1]] = body;
    }
    return out;
}

type RichTextText = { type: "text"; text: string };
type RichTextSection = { type: "rich_text_section"; elements?: RichTextNode[] };
type RichTextNode = RichTextText | RichTextSection | { type: string;[k: string]: unknown };
type Block = { elements?: RichTextNode[] };

/** Slack blocks から plain text をざっくり抽出（text ノードのみ） */
function fromBlocks(blocks: unknown): string {
    const arr: unknown = Array.isArray(blocks)
        ? blocks
        : typeof blocks === "string"
            ? (() => {
                try {
                    return JSON.parse(blocks);
                } catch {
                    return [];
                }
            })()
            : [];

    if (!Array.isArray(arr)) return "";

    const texts: string[] = [];
    const visit = (node: RichTextNode): void => {
        if (!node || typeof node !== "object") return;
        if ((node as RichTextText).type === "text" && typeof (node as RichTextText).text === "string") {
            texts.push((node as RichTextText).text);
            return;
        }
        if ((node as RichTextSection).type === "rich_text_section") {
            const children = (node as RichTextSection).elements;
            if (Array.isArray(children)) children.forEach(visit);
            return;
        }
        // 他タイプは無視
    };

    for (const b of arr as Block[]) {
        if (b && typeof b === "object" && Array.isArray(b.elements)) {
            for (const n of b.elements) visit(n);
        }
    }
    return texts.join("");
}
