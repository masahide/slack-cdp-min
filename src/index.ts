import CDP from "chrome-remote-interface";

const HOST = process.env.CDP_HOST || "127.0.0.1";
const PORT = Number(process.env.CDP_PORT || 9222);
const BROWSER_WS = process.env.BROWSER_WS; // あるなら ws://.../devtools/browser/xxx

const SLACK_API_RE = /https:\/\/[^/]+\.slack\.com\/api\/(chat\.postMessage|reactions\.[a-z]+)/i;
const SLACK_APP_RE = /https:\/\/app\.slack\.com/i;

type MsgCache = Map<string, { text?: string; user?: string }>;
const cache: MsgCache = new Map();
const key = (channel: string, ts: string) => `${channel}@${ts}`;

async function pickSlackTarget(client: CDP.Client) {
    const { Target } = client;
    const { targetInfos } = await Target.getTargets();
    const slack = targetInfos.find(t => SLACK_APP_RE.test(t.url));
    if (!slack) throw new Error("Slack page target not found (open app.slack.com in the desktop app).");
    const { sessionId } = await Target.attachToTarget({ targetId: slack.targetId, flatten: true });
    return { sessionId, slackUrl: slack.url };
}

async function main() {
    const client = BROWSER_WS ? await CDP({ target: BROWSER_WS }) : await CDP({ host: HOST, port: PORT });
    const { Target, Network, Fetch, Runtime } = client;

    const { sessionId, slackUrl } = await pickSlackTarget(client);
    console.log("[CDP] attached to:", slackUrl);

    // --- WSで流れるメッセージをキャッシュ（②段目フォールバック）
    await Network.enable({}, sessionId);
    await Network.setCacheDisabled({ cacheDisabled: true }, sessionId);

    Network.webSocketFrameReceived(e => {
        try {
            const payload = e.response.payloadData;
            if (!payload || payload.length > 512 * 1024) return;
            const d = JSON.parse(payload);
            if (d?.type === "message" && d.channel && d.ts) {
                const text = d.text ?? fromBlocks(d.blocks);
                cache.set(key(d.channel, d.ts), { text, user: d.user });
            } else if (d?.type === "message_changed" && d.channel && d.message?.ts) {
                const m = d.message;
                const text = m.text ?? fromBlocks(m.blocks);
                cache.set(key(d.channel, m.ts), { text, user: m.user });
            }
        } catch { }
    }, sessionId);

    // --- Fetch で POST をインターセプトして postData を確実に取得（①段目）
    await Fetch.enable(
        {
            patterns: [
                { urlPattern: "*://*.slack.com/api/chat.postMessage*", requestStage: "Request" },
                { urlPattern: "*://*.slack.com/api/reactions.*", requestStage: "Request" },
            ],
        },
        sessionId
    );
    // 1) requestPaused の先頭で postData を“確実に”取得
    Fetch.requestPaused(async (e) => {
        const url = e.request.url;
        if (SLACK_API_RE.test(url) && e.request.method === "POST") {
            const now = new Date().toLocaleString();

            // Content-Type と postData を取得（無ければ getRequestPostData で強制取得）
            const ct = e.request.headers?.["content-type"] || e.request.headers?.["Content-Type"] || "";
            let raw = e.request.postData ?? "";
            if (!raw) {
                try {
                    const body = await Fetch.getRequestPostData({ requestId: e.requestId }, sessionId);
                    raw = body.postData || "";
                } catch { /* 取れない環境もある */ }
            }
            console.log(`\n[POST] ${now}  ${url}`);
            console.log("  content-type:", ct || "(unknown)", "postData.length:", raw.length);

            // 2) 反応種別は pathname で厳密に
            const u = new URL(url);
            const isPost = u.pathname.endsWith("/api/chat.postMessage");
            const isReact = u.pathname.startsWith("/api/reactions.");
            const reactionType: "add" | "remove" | undefined =
                u.pathname.endsWith("/api/reactions.add") ? "add" :
                    u.pathname.endsWith("/api/reactions.remove") ? "remove" : undefined;

            let channel = "", ts = "", text = "", emoji = "";

            const m = /multipart\/form-data;\s*boundary=([-\w]+)/i.exec(ct);
            if (m) {
                const fields = parseMultipart(raw, m[1]);
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
                    if (c?.text || c?.user) console.log("  ↳ message cached:", { text: c.text, user: c.user });
                }

                // 3) urlencoded / json の順にパース（content-type なくても raw に '=' があれば試す）
            } else if (/application\/x-www-form-urlencoded/i.test(ct) || raw.includes("=")) {
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
                    if (c?.text || c?.user) console.log("  ↳ message cached:", { text: c.text, user: c.user });
                }

            } else if (/application\/json|text\/json/i.test(ct) || raw.startsWith("{")) {
                try {
                    const j = JSON.parse(raw);
                    if (isPost) {
                        channel = j.channel ?? "";
                        ts = j.ts ?? j.thread_ts ?? "";
                        text = j.text ?? fromBlocks(j.blocks ? JSON.stringify(j.blocks) : undefined);
                        console.log("  kind=post", { channel, ts, text });
                    } else if (isReact) {
                        channel = j.channel ?? "";
                        ts = j.timestamp ?? "";
                        emoji = j.name ?? "";
                        console.log("  kind=reaction", { type: reactionType, channel, ts, emoji });
                        const c = cache.get(key(channel, ts));
                        if (c?.text || c?.user) console.log("  ↳ message cached:", { text: c.text, user: c.user });
                    }
                } catch { /* noop */ }
            } else {
                console.log("  (non-urlencoded body; may be multipart/form-data or opaque)");
                // 必要なら multipart パーサを後で足せます
            }
        }

        // 続行は必ず
        await Fetch.continueRequest({ requestId: e.requestId }, sessionId);
    }, sessionId);


    // --- ③段目：レスポンス本文から message を拾えるならキャッシュ
    Network.responseReceived(async (e) => {
        if (!SLACK_API_RE.test(e.response.url)) return;
        try {
            const { body, base64Encoded } = await Network.getResponseBody({ requestId: e.requestId }, sessionId);
            const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
            const json = JSON.parse(text);
            const msg = json?.message ?? json?.item?.message;
            if (msg?.channel && (msg?.ts || msg?.message_ts)) {
                const ts = msg.ts ?? msg.message_ts;
                const val = { text: msg.text ?? fromBlocks(msg.blocks ? JSON.stringify(msg.blocks) : undefined), user: msg.user };
                cache.set(key(msg.channel, ts), val);
                console.log("  ↳ response message:", { channel: msg.channel, ts, text: val.text });
            }
        } catch {
            // 圧縮や非JSONはスキップ
        }
    }, sessionId);

    process.on("SIGINT", async () => {
        console.log("\n[CDP] closing…");
        await client.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});


function parseMultipart(raw: string, boundary: string): Record<string, string> {
    const out: Record<string, string> = {};
    const delim = `--${boundary}`;
    // パート群に分割（先頭の空/終端の--を除外）
    const parts = raw.split(delim).slice(1, -1);
    for (const part of parts) {
        // \r\n\r\n で ヘッダ/本文 に分割
        const idx = part.indexOf("\r\n\r\n");
        if (idx < 0) continue;
        const headerText = part.slice(0, idx);
        // 末尾の \r\n を削った本文
        const body = part.slice(idx + 4).replace(/\r\n$/, "");
        // Content-Disposition: form-data; name="xxx"; filename="..."
        const m = /name="([^"]+)"/i.exec(headerText);
        if (!m) continue;
        const name = m[1];
        out[name] = body;
    }
    return out;
}

function fromBlocks(blocks?: string | null): string {
    if (!blocks) return "";
    try {
        const arr = JSON.parse(blocks);
        return arr
            .flatMap((b: any) =>
                b.elements?.flatMap((e: any) =>
                    e.elements?.filter((x: any) => x.type === "text").map((x: any) => x.text)
                ) ?? []
            )
            .join("");
    } catch { return ""; }
}
