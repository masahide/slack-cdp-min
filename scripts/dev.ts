import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const execFileAsync = promisify(execFile);

type ProcessConfig = {
  name: string;
  command: string[];
  logFileName: string;
};

type ManagedProcess = {
  child: ChildProcess;
  stop: () => void;
};

const logDir = join(process.cwd(), "logs");
mkdirSync(logDir, { recursive: true });

const processConfigs: ProcessConfig[] = [
  {
    name: "backend",
    command: ["pnpm", "start"],
    logFileName: "backend-dev.log",
  },
  {
    name: "browser",
    command: ["pnpm", "--filter", "browser", "dev", "--open"],
    logFileName: "browser-dev.log",
  },
];

function runProcess(config: ProcessConfig): ManagedProcess {
  const { name, command, logFileName } = config;
  const logFile = join(logDir, logFileName);
  const logStream = createWriteStream(logFile, { flags: "a" });

  const child = spawn(command[0]!, command.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const writeLines = (data: Buffer, target: NodeJS.WriteStream) => {
    const text = data.toString();
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const isLastLine = index === lines.length - 1;
      if (line.length === 0 && isLastLine) {
        continue;
      }

      const message = `[${new Date().toISOString()}][${name}] ${line}\n`;
      logStream.write(message);
      target.write(message);
    }
  };

  child.stdout.on("data", (data) => writeLines(data, process.stdout));
  child.stderr.on("data", (data) => writeLines(data, process.stderr));

  child.on("exit", (code, signal) => {
    const exitMessage = `[${new Date().toISOString()}][${name}] exited (code=${code}, signal=${signal})\n`;
    logStream.write(exitMessage);
    process.stdout.write(exitMessage);
    logStream.end();
  });

  child.on("error", (error) => {
    const errorMessage = `[${new Date().toISOString()}][${name}] failed to start (${error.message})\n`;
    logStream.write(errorMessage);
    process.stderr.write(errorMessage);
  });

  const stop = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  return { child, stop };
}

function handleShutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const managed of managedProcesses) {
    managed.stop();
  }
}

const managedProcesses: ManagedProcess[] = [];
let shuttingDown = false;

await main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exitCode = 1;
  handleShutdown();
});

async function main() {
  const cdpHost = process.env.CDP_HOST ?? "127.0.0.1";
  const cdpPort = Number(process.env.CDP_PORT ?? "9222");

  await ensureSlackWithCdp({ host: cdpHost, port: cdpPort });

  for (const config of processConfigs) {
    managedProcesses.push(runProcess(config));
  }

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

type CdpConfig = {
  host: string;
  port: number;
};

async function ensureSlackWithCdp({ host, port }: CdpConfig) {
  if (await isCdpAvailable(host, port)) {
    console.log(
      `[INFO] Slack CDP が既に利用可能です (ws://${host}:${port}).`,
    );
    return;
  }

  const slackRunning = await isSlackRunning();
  if (slackRunning) {
    console.warn("[WARN] Slack が CDP 無効で起動しています。");
    const shouldRestart = await promptYesNo(
      "Slack を終了して CDP 有効で再起動しますか？ [y/N] ",
    );
    if (!shouldRestart) {
      throw new Error("CDP 無効の Slack が起動中のため中断します。");
    }

    await requestSlackQuit();
    await waitForSlackShutdown();
  }

  await launchSlackCdp(port);
  const ready = await waitForCdp({ host, port, retries: 20, delayMs: 500 });
  if (!ready) {
    throw new Error(
      `Slack CDP (${host}:${port}) がタイムアウト内に起動しませんでした。`,
    );
  }
}

async function isCdpAvailable(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/json/version`, {
      method: "GET",
    });
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    return typeof data.webSocketDebuggerUrl === "string";
  } catch {
    return false;
  }
}

async function waitForCdp({
  host,
  port,
  retries,
  delayMs,
}: CdpConfig & { retries: number; delayMs: number }): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await isCdpAvailable(host, port)) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function promptYesNo(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

async function isSlackRunning(): Promise<boolean> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to (name of processes) contains "Slack"',
      ]);
      return stdout.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-Process -Name Slack -ErrorAction SilentlyContinue) -ne $null",
      ]);
      return stdout.trim().toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "Slack"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function requestSlackQuit() {
  if (process.platform === "darwin") {
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "Slack" to quit',
      ]);
      return;
    } catch {
      // fall through to killall
    }
    await execFileAsync("killall", ["Slack"]);
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-Process -Name Slack -ErrorAction SilentlyContinue | Stop-Process",
    ]);
    return;
  }

  await execFileAsync("pkill", ["-f", "Slack"]);
}

async function waitForSlackShutdown() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await isSlackRunning())) {
      return;
    }
    await sleep(500);
  }
  console.warn("[WARN] Slack が終了しないため引き続き処理します。");
}

async function launchSlackCdp(port: number) {
  console.log(`[INFO] Slack を CDP 有効で起動します (port=${port}).`);
  const scriptPath = join(process.cwd(), "hack", "launch_slack_cdp.sh");
  await runAndLogCommand("bash", [scriptPath, String(port)]);
}

async function runAndLogCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`${command} ${args.join(" ")} がコード ${code} で終了しました`),
        );
      }
    });
    child.on("error", reject);
  });
}
