import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env, platform } from "node:process";

export interface AgentDef {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentStatus extends AgentDef {
  /** true = launchable now; "unknown" = probably launchable but would need a download first; false = not available */
  available: boolean | "unknown";
  note?: string;
}

export const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: "claude",
    label: "Claude",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
  },
  {
    // Official ACP adapter for Codex (successor of the deprecated @zed-industries/codex-acp).
    id: "codex",
    label: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
  },
  { id: "opencode", label: "OpenCode", command: "opencode", args: ["acp"] },
];

/** The npm package an npx-based default agent definition pulls in, if any. */
function npxPackageOf(def: AgentDef): string | null {
  if (def.command !== "npx") return null;
  for (let i = 0; i < def.args.length; i++) {
    const a = def.args[i];
    if (a === "-y" || a === "--yes" || a === "-p" || a === "--package") continue;
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
}

/** The bare adapter binary these agents expose when installed globally. */
function adapterBinOf(def: AgentDef): string | null {
  const pkg = npxPackageOf(def);
  if (!pkg) return null;
  if (pkg.endsWith("claude-agent-acp")) return "claude-agent-acp";
  if (pkg.endsWith("codex-acp")) return "codex-acp";
  return null;
}

async function existsExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(cmd: string): Promise<string | null> {
  if (cmd.includes("/") || (platform === "win32" && cmd.includes("\\"))) {
    return (await existsExecutable(cmd)) ? cmd : null;
  }
  const pathEnv = env.PATH ?? "";
  const dirs = pathEnv.split(platform === "win32" ? ";" : ":");
  const names =
    platform === "win32" && !cmd.toLowerCase().endsWith(".exe") ? [cmd, `${cmd}.exe`, `${cmd}.cmd`] : [cmd];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      if (await existsExecutable(full)) return full;
    }
  }
  return null;
}

/** Look for a package dir under the npx cache without running npx (no downloads). */
async function npxCacheHas(pkg: string): Promise<boolean> {
  // npm lays out `~/.npm/_npx/<hash>/node_modules/<pkg>` (also _npx subdirs per node version).
  const roots = [join(homedir(), ".npm", "_npx")];
  const npmCache = env.npm_config_cache;
  if (npmCache) roots.push(join(npmCache, "_npx"));
  for (const root of roots) {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const candidate = join(root, e.name, "node_modules", pkg);
        try {
          await access(candidate);
          return true;
        } catch {
          /* keep scanning */
        }
      }
    } catch {
      /* no cache dir */
    }
  }
  return false;
}

export async function detectAvailability(def: AgentDef): Promise<AgentStatus> {
  const direct = await findOnPath(def.command);
  const pkg = npxPackageOf(def);
  const bin = adapterBinOf(def);
  if (pkg && bin) {
    // npx-based adapter.
    if ((await findOnPath(bin)) ?? (await npxCacheHas(pkg))) {
      return { ...def, available: true };
    }
    if (direct) {
      return {
        ...def,
        available: "unknown",
        note: "npx is installed but the adapter package is not cached; first start will download it",
      };
    }
    return { ...def, available: false, note: "npx not found on PATH" };
  }
  if (direct) return { ...def, available: true };
  return { ...def, available: false, note: `${def.command} not found on PATH` };
}

export async function detectAll(defs: AgentDef[]): Promise<AgentStatus[]> {
  return Promise.all(defs.map((d) => detectAvailability(d)));
}

function normalizeAgentList(raw: unknown): AgentDef[] | null {
  const list = Array.isArray(raw) ? raw : (raw as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(list)) return null;
  const out: AgentDef[] = [];
  for (const item of list) {
    const a = item as Partial<AgentDef>;
    if (!a || typeof a.id !== "string" || typeof a.command !== "string") continue;
    out.push({
      id: a.id,
      label: typeof a.label === "string" ? a.label : a.id,
      command: a.command,
      args: Array.isArray(a.args) ? a.args.map(String) : [],
      ...(a.env && typeof a.env === "object" ? { env: { ...(a.env as Record<string, string>) } } : {}),
    });
  }
  return out;
}

async function readAgentsFile(file: string): Promise<AgentDef[] | null> {
  try {
    return normalizeAgentList(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Load the agent registry: defaults < global ~/.config/agentwarp/agents.json
 * < <projectDir>/.agentwarp/agents.json < agentsConfigPath. Entries merge by id
 * (later sources replace or add). Accepts either `{agents: [...]}` or `[...]`.
 */
export async function loadAgentRegistry(opts: {
  projectDir: string;
  agentsConfigPath?: string;
}): Promise<AgentDef[]> {
  const byId = new Map<string, AgentDef>(DEFAULT_AGENTS.map((d) => [d.id, { ...d }]));
  const candidates = [
    join(homedir(), ".config", "agentwarp", "agents.json"),
    join(resolve(opts.projectDir), ".agentwarp", "agents.json"),
  ];
  if (opts.agentsConfigPath) candidates.push(resolve(opts.agentsConfigPath));
  for (const file of candidates) {
    const list = await readAgentsFile(file);
    if (!list) continue;
    for (const def of list) byId.set(def.id, def);
  }
  return [...byId.values()];
}
