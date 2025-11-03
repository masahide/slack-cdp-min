import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NormalizedEvent } from "../core/events.js";

type JsonlWriterOptions = {
  dataDir: string;
};

type ErrnoLike = { code?: string };

export class JsonlWriter {
  constructor(private readonly options: JsonlWriterOptions) {}

  async append(event: NormalizedEvent): Promise<void> {
    const { dataDir } = this.options;
    const { dir, file } = this.resolvePaths(dataDir, event);
    await mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    await this.appendWithRetry(file, line);
  }

  private resolvePaths(baseDir: string, event: NormalizedEvent): { dir: string; file: string } {
    const [year, month, day] = extractDateParts(event.ts);
    const dir = join(baseDir, year, month, day, event.source);
    const file = join(dir, "events.jsonl");
    return { dir, file };
  }

  private async appendWithRetry(file: string, content: string, attempts = 2): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        await appendFile(file, content, "utf8");
        return;
      } catch (err) {
        lastError = err;
        if (i === attempts - 1) break;
        // ディレクトリが消えていた場合に備えて再作成
        if ((err as ErrnoLike)?.code === "ENOENT") {
          await mkdir(dirname(file), { recursive: true });
        }
      }
    }
    throw lastError;
  }
}

const extractDateParts = (iso: string): [string, string, string] => {
  const datePart = iso.split("T")[0] ?? "";
  const [year = "1970", month = "01", day = "01"] = datePart.split("-");
  return [year, month.padStart(2, "0"), day.padStart(2, "0")];
};
