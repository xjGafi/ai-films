import fs from "node:fs";
import path from "node:path";

let logFile: string | null = null;
let stream: fs.WriteStream | null = null;

export function initLogger(projectDir: string): void {
  logFile = path.join(projectDir, "pipeline.log");
  if (stream) stream.end();
  stream = fs.createWriteStream(logFile, { flags: "a" });
}

export function closeLogger(): void {
  if (stream) {
    stream.end();
    stream = null;
  }
  logFile = null;
}

export function log(tag: string, data: unknown): void {
  if (!stream) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${typeof data === "string" ? data : JSON.stringify(data, null, 2)}\n`;
  stream.write(line);
}
