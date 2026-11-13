import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

function safeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "session";
}

export function transcriptPath(projectDir: string, sessionId: string): string {
  return join(projectDir, ".agentwarp", "sessions", `${safeId(sessionId)}.jsonl`);
}

/** Per-file write chains so concurrent appends land in call order. */
const chains = new Map<string, Promise<void>>();

export async function appendTranscript(projectDir: string, sessionId: string, entry: unknown): Promise<void> {
  const file = transcriptPath(projectDir, sessionId);
  const line = `${JSON.stringify(entry)}\n`;
  const prev = chains.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    await mkdir(join(projectDir, ".agentwarp", "sessions"), { recursive: true });
    await appendFile(file, line, "utf8");
  });
  chains.set(file, next.catch(() => undefined));
  await next;
}

export async function readTranscript(projectDir: string, sessionId: string): Promise<unknown[] | null> {
  try {
    const text = await readFile(transcriptPath(projectDir, sessionId), "utf8");
    const out: unknown[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        /* skip corrupt lines */
      }
    }
    return out;
  } catch {
    return null;
  }
}
