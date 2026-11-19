import { execFile } from "node:child_process";
import { access, constants, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { env, platform } from "node:process";

export interface AgentDef {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Windows: run through cmd.exe (npm installs CLIs as .cmd shims, which cannot be spawned directly). */
  shell?: boolean;
}

export interface AgentStatus extends AgentDef {
  /** true = launchable now; "unknown" = probably launchable but would need a download first; false = not available */
  available: boolean | "unknown";
  note?: string;
  /** The vendor CLI this agent runs on (its install and sign-in are the user's), for onboarding. */
  cli?: {
    name: string;
    path: string | null;
    version?: string;
    /** signed in with the CLI's own account (subscription or API key) */
    auth: "authenticated" | "unauthenticated" | "unknown";
    install: string;
    login: string;
    docs: string;
  };
}

/** The CLIs behind the default agents. Agents use these CLIs and their sign-in, like T3 Code does. */
export const AGENT_CLIS: Record<string, { name: string; bin: string; install: string; login: string; docs: string }> = {
  claude: {
    name: "Claude Code",
    bin: "claude",
    install: "npm install -g @anthropic-ai/claude-code@latest",
    login: "claude auth login",
    docs: "https://docs.claude.com/en/docs/claude-code/setup",
  },
  codex: {
    name: "Codex CLI",
    bin: "codex",
    install: "npm install -g @openai/codex@latest",
    login: "codex login",
    docs: "https://developers.openai.com/codex/cli",
  },
  opencode: {
    name: "OpenCode",
    bin: "opencode",
    install: "npm install -g opencode-ai@latest",
    login: "opencode auth login",
    docs: "https://opencode.ai/docs",
  },
};

const require = createRequire(import.meta.url);

/** The ACP adapter shipped with agentwarp (packages/acp dependencies), if installed. */
function bundledAdapter(pkg: string): string | null {
  try {
    const manifest = require.resolve(`${pkg}/package.json`);
    const json = require(manifest) as { bin?: string | Record<string, string> };
    const bin = typeof json.bin === "string" ? json.bin : json.bin ? Object.values(json.bin)[0] : null;
    return bin ? join(manifest, "..", bin) : null;
  } catch {
    return null;
  }
}

/** Windows: an npm .cmd / .bat shim, which only runs through cmd.exe. */
export const isWindowsShim = (file: string): boolean => platform === "win32" && /\.(cmd|bat)$/i.test(file);

function run(file: string, args: string[], timeout = 8000): Promise<{ code: number; stdout: string }> {
  const shim = isWindowsShim(file);
  return new Promise((done) => {
    execFile(shim ? `"${file}"` : file, args, { timeout, encoding: "utf8", env: { ...env, NO_COLOR: "1" }, shell: shim || undefined }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      done({ code, stdout: `${stdout ?? ""}${stderr ?? ""}` });
    });
  });
}

/** Sign-in state of a vendor CLI, without starting a model turn. */
async function cliAuth(id: string, path: string): Promise<"authenticated" | "unauthenticated" | "unknown"> {
  if (id === "claude") {
    const r = await run(path, ["auth", "status"]);
    const m = r.stdout.match(/"loggedIn"\s*:\s*(true|false)/);
    return m ? (m[1] === "true" ? "authenticated" : "unauthenticated") : "unknown";
  }
  if (id === "codex") {
    const r = await run(path, ["login", "status"]);
    if (r.code === 0 && /logged in/i.test(r.stdout)) return "authenticated";
    return /not logged in/i.test(r.stdout) || r.code !== 0 ? "unauthenticated" : "unknown";
  }
  // OpenCode also runs free models without any sign-in.
  return "unknown";
}

const cliCache = new Map<string, { at: number; value: AgentStatus["cli"] }>();

async function cliStatus(id: string): Promise<AgentStatus["cli"]> {
  const meta = AGENT_CLIS[id];
  if (!meta) return undefined;
  const hit = cliCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const path = await findOnPath(meta.bin);
  let version: string | undefined;
  let auth: "authenticated" | "unauthenticated" | "unknown" = "unknown";
  if (path) {
    const [v, a] = await Promise.all([run(path, ["--version"], 5000), cliAuth(id, path)]);
    version = v.code === 0 ? v.stdout.trim().split("\n")[0]?.slice(0, 80) : undefined;
    auth = a;
  }
  const value = { name: meta.name, path, version, auth, install: meta.install, login: meta.login, docs: meta.docs };
  cliCache.set(id, { at: Date.now(), value });
  return value;
}

/** Forget cached CLI checks (after the user installed or signed in). */
export function refreshCliStatus(): void {
  cliCache.clear();
}

/**
 * Windows: the program an npm .cmd shim starts (`"%dp0%\node_modules\…\cli.js" %*`), so it can be
 * started without a shell. null when the shim does not name one.
 */
export async function shimTarget(file: string): Promise<string | null> {
  if (!isWindowsShim(file)) return file;
  try {
    const text = await readFile(file, "utf8");
    const hits = [...text.matchAll(/"%~?dp0%?\\([^"%]+?\.(?:exe|js|cjs|mjs))"/gi)];
    const last = hits[hits.length - 1];
    if (last) return join(dirname(file), last[1]);
  } catch {
    // unreadable shim
  }
  return null;
}

/** Find a file by name under dir (a few levels deep), e.g. codex.exe inside the @openai/codex package. */
async function findFile(dir: string, name: string, depth = 6): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name) return join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".bin") continue;
    const hit = await findFile(join(dir, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * The installed vendor CLI as a program the ACP adapter can start itself: on Windows the npm shim
 * is resolved to its .exe (or, for Claude Code, its .js, which the SDK runs with node).
 */
async function vendorExecutable(bin: "claude" | "codex"): Promise<string | null> {
  const found = await findOnPath(bin);
  if (!found || !isWindowsShim(found)) return found;
  const target = await shimTarget(found);
  if (target && /\.exe$/i.test(target)) return target;
  if (bin === "claude" && target) return target;
  // Codex's npm launcher is a .js that starts a native codex.exe shipped in the package.
  const pkgRoot = target ? target.slice(0, target.toLowerCase().lastIndexOf("node_modules") + "node_modules".length) : join(dirname(found), "node_modules");
  return findCodexExe(pkgRoot);
}

/**
 * codex.exe under a node_modules folder holding @openai/codex. npm -g nests the platform package
 * inside the launcher's own node_modules, seven folders below @openai:
 * `@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`.
 */
export const findCodexExe = (nodeModules: string): Promise<string | null> =>
  findFile(join(nodeModules, "@openai"), "codex.exe", 8);

/**
 * How to start an agent. Claude and Codex run through the ACP adapter shipped with agentwarp on
 * this Node (Electron's in the desktop app), pointed at the user's installed CLI, so they use the
 * CLI's own sign-in and nothing is downloaded at first use. Falls back to the plain definition.
 */
export async function resolveLaunch(def: AgentDef): Promise<AgentDef> {
  const pkg = npxPackageOf(def);
  if (!pkg) return windowsCommand(def);
  const adapter = bundledAdapter(pkg);
  if (!adapter) return windowsCommand(def);
  const extra: Record<string, string> = {};
  if (def.id === "claude" || pkg.endsWith("claude-agent-acp")) {
    const cli = await vendorExecutable("claude");
    if (cli && !env.CLAUDE_CODE_EXECUTABLE) extra.CLAUDE_CODE_EXECUTABLE = cli;
  }
  if (def.id === "codex" || pkg.endsWith("codex-acp")) {
    const cli = await vendorExecutable("codex");
    if (cli && !env.CODEX_PATH) extra.CODEX_PATH = cli;
  }
  return { ...def, command: process.execPath, args: [adapter], env: { ...extra, ...(def.env ?? {}) } };
}

/** Windows: a bare command (e.g. `opencode`) is an npm .cmd shim: start its .exe, else go through cmd.exe. */
async function windowsCommand(def: AgentDef): Promise<AgentDef> {
  if (platform !== "win32" || /[\\/]/.test(def.command)) return def;
  const found = await findOnPath(def.command);
  if (!found || !isWindowsShim(found)) return found ? { ...def, command: found } : def;
  const target = await shimTarget(found);
  if (target && /\.exe$/i.test(target)) return { ...def, command: target };
  return { ...def, command: found, shell: true };
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
  // Windows: npm puts claude.cmd next to an extensionless sh script (for Git Bash) that cannot be spawned.
  const names =
    platform === "win32" && !/\.(exe|cmd|bat)$/i.test(cmd) ? [`${cmd}.exe`, `${cmd}.cmd`, `${cmd}.bat`] : [cmd];
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
  const isDefault = DEFAULT_AGENTS.some((d) => d.id === def.id && d.command === def.command && d.args.join(" ") === def.args.join(" "));
  const cli = isDefault ? await cliStatus(def.id) : undefined;
  if (cli) {
    // Default agents need the vendor CLI (its sign-in is what the agent uses).
    const pkg = npxPackageOf(def);
    if (!cli.path) return { ...def, available: false, cli, note: `${cli.name} is not installed` };
    if (pkg && bundledAdapter(pkg)) return { ...def, available: true, cli };
    if (!pkg) return { ...def, available: true, cli };
  }
  const withCli = (s: AgentStatus): AgentStatus => (cli ? { ...s, cli } : s);
  const direct = await findOnPath(def.command);
  const pkg = npxPackageOf(def);
  const bin = adapterBinOf(def);
  if (pkg && bin) {
    // npx-based adapter.
    if ((await findOnPath(bin)) ?? (await npxCacheHas(pkg))) {
      return withCli({ ...def, available: true });
    }
    if (direct) {
      return withCli({
        ...def,
        available: "unknown",
        note: "npx is installed but the adapter package is not cached; first start will download it",
      });
    }
    return withCli({ ...def, available: false, note: "npx not found on PATH" });
  }
  if (direct) return withCli({ ...def, available: true });
  return withCli({ ...def, available: false, note: `${def.command} not found on PATH` });
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
