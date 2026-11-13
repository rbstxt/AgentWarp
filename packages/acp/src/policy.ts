import { isAbsolute, relative, resolve, sep } from "node:path";

export interface PermissionOptionLike {
  optionId: string;
  kind?: string;
  name?: string;
}

function insideDir(projectDir: string, p: string): boolean {
  const root = resolve(projectDir);
  const abs = resolve(root, p);
  return abs === root || abs.startsWith(root + sep);
}

function uriToPath(uri: string): string | null {
  if (uri.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return null;
    }
  }
  if (uri.startsWith("/")) return uri;
  return null;
}

function looksLikePath(s: string): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > 1024) return false;
  if (s.includes("\n")) return false;
  return (
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith("file://") ||
    /^[A-Za-z0-9_@.~-][A-Za-z0-9_@./~-]*\.[A-Za-z0-9]{1,8}$/.test(s)
  );
}

const PATH_KEYS = new Set([
  "path",
  "file",
  "filePath",
  "filename",
  "filepath",
  "uri",
  "directory",
  "dir",
  "cwd",
]);

const COMMAND_KEYS = new Set(["command", "commands", "cmd", "script"]);

/** Collect candidate file paths from a tool call's locations/rawInput/content. */
export function extractPaths(toolCall: {
  locations?: Array<{ path?: string; uri?: string }> | null;
  rawInput?: unknown;
  content?: Array<Record<string, unknown>> | null;
}): string[] {
  const out: string[] = [];
  for (const loc of toolCall.locations ?? []) {
    if (!loc) continue;
    if (typeof loc.path === "string" && loc.path) out.push(loc.path);
    else if (typeof loc.uri === "string" && loc.uri) {
      const p = uriToPath(loc.uri);
      if (p) out.push(p);
    }
  }
  const seen = new Set<unknown>();
  const walk = (v: unknown, keyHint: string): void => {
    if (typeof v === "string") {
      if ((PATH_KEYS.has(keyHint) || looksLikePath(v)) && !v.includes(" ")) out.push(v);
      return;
    }
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) walk(item, keyHint);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (COMMAND_KEYS.has(k)) continue; // commands handled separately
      walk(val, k);
    }
  };
  walk(toolCall.rawInput, "");
  for (const c of toolCall.content ?? []) {
    if (c && typeof c === "object") {
      const meta = (c as { _meta?: unknown })._meta;
      if (meta) walk(meta, "");
      const pathField = (c as { path?: unknown }).path;
      if (typeof pathField === "string") out.push(pathField);
    }
  }
  return out;
}

/** Collect candidate shell commands from a tool call's rawInput. */
export function extractCommands(toolCall: { rawInput?: unknown }): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, keyHint: string): void => {
    if (typeof v === "string") {
      if (COMMAND_KEYS.has(keyHint)) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      if (COMMAND_KEYS.has(keyHint)) {
        for (const item of v) if (typeof item === "string") out.push(item);
        return;
      }
      for (const item of v) {
        if (item && typeof item === "object" && !seen.has(item)) {
          seen.add(item);
          for (const [k, val] of Object.entries(item as Record<string, unknown>)) walk(val, k);
        }
      }
      return;
    }
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) walk(val, k);
  };
  walk(toolCall.rawInput, "");
  return out;
}

function firstWord(cmd: string): string {
  const m = cmd.trim().match(/^([^\s]+)/);
  return m ? m[1] : "";
}

function isAgentwarpCommand(cmd: string, projectDir: string): boolean {
  let rest = cmd.trim();
  // Tolerate common `cd <dir> && ...` / env-prefix wrappers.
  const cdMatch = rest.match(/^cd\s+(\S+)\s+&&\s+(.*)$/);
  if (cdMatch) {
    const cdDir = resolve(projectDir, cdMatch[1]);
    if (relative(resolve(projectDir), cdDir).startsWith("..")) return false;
    rest = cdMatch[2];
  }
  rest = rest.replace(/^([A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
  const word = firstWord(rest);
  if (!word) return false;
  if (word === "agentwarp") return true;
  if (word === "bin/agentwarp" || word.endsWith("/bin/agentwarp")) {
    return insideDir(projectDir, isAbsolute(word) ? word : resolve(projectDir, word));
  }
  return false;
}

function pickAllowOption(options: PermissionOptionLike[]): PermissionOptionLike | null {
  return (
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind === "allow_always") ??
    options.find((o) => typeof o.kind === "string" && o.kind.startsWith("allow")) ??
    null
  );
}

export interface ToolCallLike {
  toolCallId?: string;
  title?: string;
  name?: string | null;
  kind?: string;
  status?: string;
  content?: Array<Record<string, unknown>> | null;
  locations?: Array<{ path?: string; uri?: string }> | null;
  rawInput?: unknown;
}

/**
 * Default permission policy. Returns the optionId to auto-select, or null to
 * ask the user. Auto-allows when the tool call provably only touches files
 * inside projectDir, or only runs `agentwarp` / `bin/agentwarp` commands.
 * Pure `think` calls (no side effects) are auto-allowed. Anything
 * indeterminate (no paths/commands found, outside paths, other commands)
 * returns null so the panel asks the user.
 */
export function chooseAutoAllow(
  toolCall: ToolCallLike,
  options: PermissionOptionLike[],
  projectDir: string,
): string | null {
  const allow = pickAllowOption(options);
  if (!allow) return null;
  const kind = (toolCall.kind ?? "").toLowerCase();
  const name = (toolCall.name ?? "").toLowerCase();

  if (kind === "think") return allow.optionId;

  const commands = extractCommands(toolCall);
  const isExecute = kind === "execute" || name.includes("bash") || name.includes("shell") || name.includes("exec");
  if (commands.length > 0 || isExecute) {
    if (commands.length === 0) return null; // execute-kind but no visible command: ask
    const ok = commands.every((c) => isAgentwarpCommand(c, projectDir));
    return ok ? allow.optionId : null;
  }

  const paths = extractPaths(toolCall);
  if (paths.length === 0) return null; // indeterminate: ask
  const ok = paths.every((p) => {
    const abs = isAbsolute(p) || p.startsWith("file://") ? (uriToPath(p) ?? p) : resolve(projectDir, p);
    return insideDir(projectDir, abs);
  });
  return ok ? allow.optionId : null;
}
