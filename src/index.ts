import { resolveDataDir, resolveEndpoint } from "./runtime/config.js";
import { connectToSlackPage } from "./runtime/slackConnection.js";
import { JsonlWriter } from "./io/jsonlWriter.js";
import { SlackAdapter } from "./slack/adapter.js";
import { SlackIngestor } from "./pipeline/slackIngestor.js";

async function main() {
  const { host, port } = resolveEndpoint();
  console.log(`[ReacLog] CDP endpoint -> ${host}:${port}`);

  const { client, slackUrl } = await connectToSlackPage(host, port);
  console.log(`[ReacLog] attached to: ${slackUrl}`);

  const dataDir = resolveDataDir();
  console.log(`[ReacLog] dataDir -> ${dataDir}`);

  const timezone = process.env.REACLOG_TZ || "Asia/Tokyo";
  console.log(`[ReacLog] timezone -> ${timezone}`);

  const adapter = new SlackAdapter({ client, now: () => new Date(), timezone });
  const writer = new JsonlWriter({ dataDir });
  const ingestor = new SlackIngestor({ adapter, writer });

  await ingestor.start();
  console.log("[ReacLog] Slack ingestion started");

  const shutdown = async (signal: string) => {
    console.log(`[ReacLog] received ${signal}, shutting down...`);
    await ingestor.stop();
    if (typeof client.close === "function") await client.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[ReacLog] fatal:", err);
  process.exit(1);
});
