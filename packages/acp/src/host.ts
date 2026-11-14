import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable, Writable } from "node:stream";
import {
  client,
  ndJsonStream,
  type ActiveSession,
  type AgentCapabilities,
  type ClientConnection,
  type ClientContext,
} from "@agentclientprotocol/sdk";
import {
  detectAll,
  loadAgentRegistry,
  type AgentDef,
  type AgentStatus,
} from "./agents.ts";
import { chooseAutoAllow, type PermissionOptionLike } from "./policy.ts";
import { appendTranscript, readTranscript } from "./transcripts.ts";

export const HOST_VERSION = "0.1.0";

export interface AcpHostOptions {
  projectDir: string;
  send: (msg: object) => void;
  agentsConfigPath?: string;
  log?: (...a: unknown[]) => void;
  /** Default permission policy (auto-allow project-local edits + agentwarp commands). Default true. */
  autoAllow?: boolean;
  /** How long to wait for an acp/permission reply before treating it as rejected. Default 10 min. */
  permissionTimeoutMs?: number;
  /** Test hook: bypass the on-disk registry with a fixed agent list. */
  agents?: AgentDef[];
  /**
   * Checkpoint/change store for agent-panel turns (P7 §6). The bridge
   * provides a filesystem implementation; without one, prompts still run
   * but no turn-start/checkpoint/restore/changes messages are produced and
   * acp/restore + acp/changes answer acp/error.
   */
  turnStore?: TurnStore;
}

/** A @-mention from the panel composer (P7 §5). */
export interface Mention {
  kind: string;
  target: string;
  name?: string;
  topBlockId?: string;
}

export interface ChangeScript {
  status: "added" | "changed" | "deleted";
  topBlockId: string;
  anchor?: string;
  label: string;
  summary?: { opcode: string; fields: Record<string, string>; blockCount: number };
  scratchblocks: string;
  file: string;
  line?: number;
}

export interface ChangeTarget {
  name: string;
  isStage: boolean;
  scripts: ChangeScript[];
}

/**
 * Per-turn checkpoint + change-summary store. Implemented by the bridge
 * (it owns rev, the base project and the text format); consumed here.
 */
export interface TurnStore {
  /** Current bridge rev (recorded in checkpoints + turn-start). */
  getRev(): number;
  /** Snapshot the text state for a turn (plus the current rev). */
  snapshot(sessionId: string, turnId: string): Promise<void>;
  /**
   * Write a snapshot back into the text dir (removing target dirs created
   * after it). Resolves with the snapshot's rev; the bridge's normal agent
   * cycle then packs + pushes. Rejects when the turn is unknown.
   */
  restore(sessionId: string, turnId: string): Promise<number>;
  /** Diff a turn's checkpoint against the current base. */
  diff(sessionId: string, turnId: string): Promise<ChangeTarget[]>;
}

export interface AcpHost {
  handle(msg: unknown, reply?: (msg: object) => void): Promise<void>;
  dispose(): Promise<void>;
  /** True while the session has a turn in flight (used to refuse restore). */
  isTurnRunning(sessionId: string): boolean;
  /**
   * Called by the bridge after it commits a new base (agent-edit cycle or
   * editor POST). Emits debounced live acp/changes for running turns.
   */
  onBaseUpdated(): void;
}

interface PendingPermission {
  options: PermissionOptionLike[];
  toolKey: string;
  sessionId: string;
  resolve: (optionId: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnState {
  def: AgentDef;
  child: ChildProcess;
  connection: ClientConnection;
  agent: ClientContext;
  dead: boolean;
  stderrTail: string;
  sessions: Set<string>;
  /** Agent's initialize capabilities (prompt caps, load/resume support). */
  caps?: AgentCapabilities | null;
}

interface SessionState {
  sessionId: string;
  agentId: string;
  active: ActiveSession;
  turnRunning: boolean;
  /** Checkpoint turn id of the running turn (null when idle). */
  currentTurn: string | null;
  /** Pending debounced live-changes timer. */
  liveTimer: ReturnType<typeof setTimeout> | null;
  pump: Promise<void>;
  configOptions: ActiveSession['newSessionResponse']['configOptions'];
  modes: ActiveSession['newSessionResponse']['modes'];
}

/** Derive panel modes from v1 session config options (category "mode") as a fallback. */
export function modesOf(configOptions: unknown): ActiveSession['newSessionResponse']['modes'] {
  if (!Array.isArray(configOptions)) return undefined;
  const opts = configOptions.filter((o) => o && typeof o === "object") as Array<Record<string, unknown>>;
  const opt =
    opts.find((o) => o.type === "select" && o.category === "mode") ??
    opts.find((o) => o.type === "select" && ((o as { id?: unknown }).id === "mode"));
  if (!opt || typeof (opt as { currentValue?: unknown }).currentValue !== "string") return undefined;
  const availableModes: Array<{ id: string; name: string; description?: string }> = [];
  const push = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (Array.isArray(r.options)) {
      for (const sub of r.options) push(sub);
      return;
    }
    if (typeof r.value !== "string") return;
    const mode: { id: string; name: string; description?: string } = { id: r.value, name: typeof r.name === "string" ? r.name : r.value };
    if (typeof r.description === "string" && r.description) mode.description = r.description;
    availableModes.push(mode);
  };
  if (Array.isArray(opt.options)) for (const v of opt.options) push(v);
  return {
    currentModeId: (opt as { currentValue: string }).currentValue,
    availableModes,
  };
}

/** Find the on-disk directory entry for a target name (via target.json). */
async function findTargetDir(projectDir: string, targetName: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".agentwarp" || e.name.startsWith(".")) continue;
    try {
      const tj = JSON.parse(await readFile(join(projectDir, e.name, "target.json"), "utf8"));
      if (tj?.name === targetName) return e.name;
    } catch {
      /* not a target dir */
    }
  }
  return null;
}

/** Max sourcemap line of the script rooted at topId (for mention line ranges). */
function scriptEndLine(project: unknown, topId: string, locs: Record<string, { line?: unknown }>): number | null {
  const byId = new Map<string, any>();
  for (const t of ((project as { targets?: unknown[] } | null)?.targets ?? [])) {
    const blocks = (t as { blocks?: Record<string, any> } | null)?.blocks;
    if (blocks && typeof blocks === "object") {
      for (const [id, b] of Object.entries(blocks)) byId.set(id, b);
    }
  }
  if (!byId.has(topId)) return null;
  let max: number | null = null;
  const seen = new Set<string>([topId]);
  const stack = [topId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const line = locs[id]?.line;
    if (typeof line === "number" && (max == null || line > max)) max = line;
    const b = byId.get(id);
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;
    if (typeof b.next === "string" && !seen.has(b.next)) {
      seen.add(b.next);
      stack.push(b.next);
    }
    for (const ival of Object.values<any>(b.inputs ?? {})) {
      if (Array.isArray(ival) && typeof ival[1] === "string" && !seen.has(ival[1])) {
        seen.add(ival[1]);
        stack.push(ival[1]);
      }
    }
  }
  return max;
}

/**
 * Build one ACP `resource_link` block per resolvable mention (P7 §5):
 * the target's scripts file URI, with a `#Lstart-Lend` fragment for script
 * mentions whose top block id resolves through the pack sourcemap.
 * Unresolvable mentions (unknown target, no scripts file) are skipped.
 */
export async function mentionLinks(
  projectDir: string,
  mentions: Mention[],
): Promise<Array<Record<string, unknown>>> {
  let sourcemap: Record<string, { line?: unknown }> = {};
  try {
    sourcemap = JSON.parse(await readFile(join(projectDir, ".agentwarp", "sourcemap.json"), "utf8"));
  } catch {
    /* no sourcemap yet */
  }
  let base: unknown = null;
  try {
    base = JSON.parse(await readFile(join(projectDir, ".agentwarp", "base.json"), "utf8"));
  } catch {
    /* no base yet */
  }
  const out: Array<Record<string, unknown>> = [];
  for (const m of mentions) {
    if (!m || typeof m.target !== "string" || !m.target) continue;
    const dirEntry = await findTargetDir(projectDir, m.target);
    if (!dirEntry) continue;
    let scriptsFile: string | null = null;
    try {
      const names = (await readdir(join(projectDir, dirEntry))).filter((n) => n.startsWith("scripts.")).sort();
      scriptsFile = names[0] ?? null;
    } catch {
      /* unreadable */
    }
    if (!scriptsFile) continue;
    const url = pathToFileURL(resolve(projectDir, dirEntry, scriptsFile));
    const loc = m.topBlockId ? (sourcemap[m.topBlockId] as { line?: unknown } | undefined) : undefined;
    if (loc && typeof loc.line === "number") {
      const start = loc.line;
      let end: number | null = null;
      if (base && m.topBlockId) end = scriptEndLine(base, m.topBlockId, sourcemap);
      url.hash = end != null && end >= start ? `#L${start}-L${end}` : `#L${start}`;
    }
    const label =
      m.kind === "script" && m.topBlockId
        ? `script ${m.name ?? m.topBlockId} in ${m.target}`
        : `${m.kind || "context"} ${m.name ?? m.target}`;
    out.push({
      type: "resource_link",
      uri: url.toString(),
      name: `${dirEntry}/${scriptsFile}`,
      title: label,
    });
  }
  return out;
}

function sessionMetaPath(projectDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "session";
  return join(projectDir, ".agentwarp", "sessions", `${safe}.meta.json`);
}

async function writeSessionMeta(projectDir: string, sessionId: string, agentId: string): Promise<void> {
  try {
    await mkdir(join(projectDir, ".agentwarp", "sessions"), { recursive: true });
    await writeFile(
      sessionMetaPath(projectDir, sessionId),
      JSON.stringify({ agentId, startedAt: new Date().toISOString() }) + "\n",
    );
  } catch {
    /* sessions list degrades to agentId "unknown" */
  }
}

async function readSessionAgent(projectDir: string, sessionId: string): Promise<string | undefined> {
  try {
    const meta = JSON.parse(await readFile(sessionMetaPath(projectDir, sessionId), "utf8"));
    return typeof meta?.agentId === "string" ? meta.agentId : undefined;
  } catch {
    return undefined;
  }
}

/** Strip the prepended `[TurboWarp] …` context block for title display. */
function titleText(full: string): string {
  let t = full;
  if (t.startsWith("[TurboWarp]")) {
    const i = t.indexOf("\n\n");
    t = i >= 0 ? t.slice(i + 2) : "";
  }
  return t.replace(/\s+/g, " ").trim().slice(0, 80);
}

export interface SessionListEntry {
  sessionId: string;
  agentId: string;
  title: string;
  updatedAt: string;
  turns: number;
}

/** Newest-first session list from `.agentwarp/sessions/*.jsonl` (P7 §5). */
export async function listSessions(projectDir: string): Promise<SessionListEntry[]> {
  let entries;
  try {
    entries = await readdir(join(projectDir, ".agentwarp", "sessions"));
  } catch {
    return [];
  }
  const out: SessionListEntry[] = [];
  for (const e of entries) {
    if (!e.endsWith(".jsonl")) continue;
    const sessionId = e.slice(0, -".jsonl".length);
    const file = join(projectDir, ".agentwarp", "sessions", e);
    let lines: string[];
    try {
      lines = (await readFile(file, "utf8")).split("\n");
    } catch {
      continue;
    }
    let title: string | null = null;
    let firstUser: string | null = null;
    let turns = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(t);
      } catch {
        continue;
      }
      if (parsed?.kind === "update" && parsed?.update?.sessionUpdate === "session_info_update") {
        if (typeof parsed.update.title === "string" && parsed.update.title) title = parsed.update.title;
      } else if (parsed?.kind === "user") {
        turns += 1;
        if (firstUser == null && typeof parsed.text === "string") firstUser = parsed.text;
      }
    }
    let updatedAt: string;
    try {
      updatedAt = (await stat(file)).mtime.toISOString();
    } catch {
      continue;
    }
    out.push({
      sessionId,
      agentId: (await readSessionAgent(projectDir, sessionId)) ?? "unknown",
      title: title ?? titleText(firstUser ?? ""),
      updatedAt,
      turns,
    });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Build the `[TurboWarp] …` context line prepended to prompts (docs/P5-DESIGN.md). */
export function formatEditorContext(context: unknown): string {
  if (context == null) return "";
  if (typeof context === "string") return context ? `[TurboWarp] ${context}` : "";
  if (typeof context !== "object") return "";
  const c = context as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" && v ? v : "");
  const num = (v: unknown): string =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  const parts: string[] = [];
  const target = str(c.editingTarget ?? c.target);
  const scripts = str(c.scriptsPath ?? c.scripts);
  if (target || scripts) {
    parts.push(`editing: ${target || "?"}${scripts ? ` (${scripts})` : ""}`);
  }
  const selected = str(c.selectedBlock ?? c.selected ?? c.selectedBlockId);
  const loc = str(c.selectedLocation ?? c.location ?? c.anchor);
  if (selected || loc) {
    parts.push(`selected: ${selected || "?"}${loc ? ` (${loc})` : ""}`);
  }
  const rev = num(c.rev);
  if (rev) parts.push(`rev ${rev}`);
  if (c.running === true) parts.push("running");
  const stage = str(c.stageSize ?? c.stage);
  if (stage) parts.push(`stage ${stage}`);
  return parts.length > 0 ? `[TurboWarp] ${parts.join(" · ")}` : "";
}

export function createAcpHost(opts: AcpHostOptions): AcpHost {
  let projectDir: string = opts.projectDir;
  try {
    projectDir = realpathSync(opts.projectDir);
  } catch {
    /* project dir may not exist yet; use as-is */
  }
  const log: (...a: unknown[]) => void = opts.log ?? (() => undefined);
  const autoAllow = opts.autoAllow ?? true;
  const permissionTimeoutMs = opts.permissionTimeoutMs ?? 10 * 60 * 1000;
  const turnStore = opts.turnStore;

  let registry: AgentDef[] | null = opts.agents ? [...opts.agents] : null;
  const conns = new Map<string, ConnState>();
  const sessions = new Map<string, SessionState>();
  const pendingPerms = new Map<string, PendingPermission>();
  /** "always" decisions: `${sessionId}:${toolKey}` -> optionId */
  const sticky = new Map<string, string>();
  let permSeq = 0;
  let turnSeq = 0;
  let disposed = false;

  function emit(msg: object): void {
    try {
      opts.send(msg);
    } catch (e) {
      log("acp send failed:", e);
    }
  }

  async function agents(): Promise<AgentDef[]> {
    if (!registry) registry = await loadAgentRegistry({ projectDir, agentsConfigPath: opts.agentsConfigPath });
    return registry;
  }

  function findSession(sessionId: string): SessionState | undefined {
    return sessions.get(sessionId);
  }

  function isTurnRunning(sessionId: string): boolean {
    return findSession(sessionId)?.turnRunning === true;
  }

  /** Bridge hook: a new base was committed; emit debounced live changes. */
  function onBaseUpdated(): void {
    if (!turnStore || disposed) return;
    for (const sess of sessions.values()) {
      if (!sess.turnRunning || !sess.currentTurn || sess.liveTimer) continue;
      const turnId = sess.currentTurn;
      sess.liveTimer = setTimeout(() => {
        sess.liveTimer = null;
        if (disposed || !sessions.has(sess.sessionId) || !sess.turnRunning || sess.currentTurn !== turnId) return;
        void turnStore.diff(sess.sessionId, turnId).then(
          (targets) => {
            if (!disposed && sess.turnRunning && sess.currentTurn === turnId) {
              emit({ type: "acp/changes", sessionId: sess.sessionId, turnId, final: false, targets });
            }
          },
          (e) => log(`acp/changes (live) diff failed: ${(e as Error)?.message ?? e}`),
        );
      }, 1000);
    }
  }

  function settlePermission(requestId: string, optionId: string | null): void {
    const p = pendingPerms.get(requestId);
    if (!p) return;
    pendingPerms.delete(requestId);
    clearTimeout(p.timer);
    const valid = optionId != null && p.options.some((o) => o.optionId === optionId);
    if (!valid && optionId != null) {
      log(`acp/permission: unknown optionId ${optionId} for ${requestId}; treating as reject`);
    }
    const chosen = valid ? (optionId as string) : null;
    if (chosen) {
      const kind = p.options.find((o) => o.optionId === chosen)?.kind;
      if (kind === "allow_always" || kind === "reject_always") {
        sticky.set(`${p.sessionId}:${p.toolKey}`, chosen);
      }
    }
    p.resolve(chosen);
  }

  function onChildExit(conn: ConnState, info: string): void {
    if (conn.dead) return;
    conn.dead = true;
    conns.delete(conn.def.id);
    const suffix = conn.stderrTail ? `: ${conn.stderrTail}` : "";
    const message = `agent ${conn.def.id} exited (${info})${suffix}`;
    log(message);
    for (const sid of conn.sessions) {
      const s = sessions.get(sid);
      if (s?.turnRunning) {
        s.turnRunning = false;
        emit({ type: "acp/error", sessionId: sid, message });
      }
      sessions.delete(sid);
    }
    // Unblock any permission handlers waiting on this agent.
    for (const [id, p] of [...pendingPerms]) {
      const sess = sessions.get(p.sessionId);
      if (!sess || sess.agentId === conn.def.id) settlePermission(id, null);
    }
    try {
      conn.connection.close();
    } catch {
      /* ignore */
    }
  }

  async function ensureConn(def: AgentDef): Promise<ConnState> {
    const existing = conns.get(def.id);
    if (existing && !existing.dead) return existing;

    let command = def.command;
    // Resolve relative command paths against the project dir.
    if (command.startsWith("./") || command.startsWith("../") || command.startsWith(".")) {
      const { resolve } = await import("node:path");
      command = resolve(projectDir, command);
    }

    let child: ChildProcess;
    try {
      child = spawn(command, def.args, {
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(def.env ?? {}) },
      });
    } catch (e) {
      throw new Error(`failed to spawn ${def.id} (${command}): ${(e as Error)?.message}`);
    }

    const conn: ConnState = {
      def,
      child,
      connection: undefined as unknown as ClientConnection,
      agent: undefined as unknown as ClientContext,
      dead: false,
      stderrTail: "",
      sessions: new Set(),
    };

    child.on("error", (e) => {
      onChildExit(conn, `spawn error: ${(e as Error)?.message}`);
      void appendTranscript(projectDir, `agent-${def.id}`, {
        kind: "error",
        message: `spawn error: ${(e as Error)?.message}`,
      }).catch(() => undefined);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = String(d);
      conn.stderrTail = `${conn.stderrTail}${text}`.slice(-2000);
      for (const line of text.split("\n")) {
        if (line.trim()) log(`[${def.id} stderr]`, line);
      }
    });
    child.on("exit", (code, signal) => {
      onChildExit(conn, code != null ? `code ${code}` : `signal ${signal}`);
    });

    if (!child.stdin || !child.stdout) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      throw new Error(`failed to spawn ${def.id}: stdio unavailable`);
    }

    const app = client({ name: "agentwarp-acp-host" });
    app.onRequest("session/request_permission", async (ctx) => {
      const params = ctx.params as {
        sessionId: string;
        toolCall: Record<string, unknown>;
        options: PermissionOptionLike[];
      };
      const toolCall = params.toolCall ?? {};
      const options = params.options ?? [];
      const toolKey = String(
        (toolCall as { name?: unknown }).name ?? (toolCall as { title?: unknown }).title ?? "?",
      );
      const rejectFallback = options.find((o) => o.kind === "reject_once");
      if (options.length === 0) return { outcome: { outcome: "cancelled" } } as const;

      const stickyKey = `${params.sessionId}:${toolKey}`;
      const remembered = sticky.get(stickyKey);
      if (remembered && options.some((o) => o.optionId === remembered)) {
        log(`permission ${toolKey}: applying remembered ${remembered}`);
        return { outcome: { outcome: "selected", optionId: remembered } } as const;
      }

      if (autoAllow) {
        const auto = chooseAutoAllow(
          toolCall as Parameters<typeof chooseAutoAllow>[0],
          options,
          projectDir,
        );
        if (auto) {
          log(`permission ${toolKey}: auto-allowed by default policy`);
          void appendTranscript(projectDir, params.sessionId, {
            kind: "permission-auto",
            toolCall,
            optionId: auto,
          }).catch(() => undefined);
          return { outcome: { outcome: "selected", optionId: auto } } as const;
        }
      }

      const requestId = `perm-${++permSeq}`;
      emit({
        type: "acp/permission-request",
        requestId,
        sessionId: params.sessionId,
        toolCall,
        options,
      });
      const optionId = await new Promise<string | null>((resolvePromise) => {
        const timer = setTimeout(() => settlePermission(requestId, null), permissionTimeoutMs);
        pendingPerms.set(requestId, {
          options,
          toolKey,
          sessionId: params.sessionId,
          resolve: resolvePromise,
          timer,
        });
      });
      if (optionId == null) {
        if (rejectFallback) return { outcome: { outcome: "selected", optionId: rejectFallback.optionId } } as const;
        return { outcome: { outcome: "cancelled" } } as const;
      }
      return { outcome: { outcome: "selected", optionId } } as const;
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    conn.connection = connection;
    conn.agent = connection.agent;

    try {
      const initResp = await conn.agent.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: {}, terminal: false },
        clientInfo: { name: "agentwarp-acp-host", version: HOST_VERSION },
      });
      conn.caps = (initResp as { agentCapabilities?: AgentCapabilities })?.agentCapabilities ?? null;
    } catch (e) {
      const message = `agent ${def.id} initialize failed: ${(e as Error)?.message}${conn.stderrTail ? `: ${conn.stderrTail}` : ""}`;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      conns.delete(def.id);
      throw new Error(message);
    }
    connection.closed
      .then(() => onChildExit(conn, "connection closed"))
      .catch(() => undefined);
    conns.set(def.id, conn);
    return conn;
  }

  function startPump(sess: SessionState): void {
    sess.pump = (async () => {
      try {
        for (;;) {
          if (disposed) return;
          const msg = await sess.active.nextUpdate();
          if (msg.kind === "session_update") {
            // Preserve ACP locations and add a project-relative path for the
            // panel's authenticated image endpoint, including for absolute paths.
            if ((msg.update.sessionUpdate === 'tool_call' || msg.update.sessionUpdate === 'tool_call_update') && Array.isArray(msg.update.locations)) {
              msg.update.locations = msg.update.locations.map((location) => {
                const path = location.path;
                if (typeof path !== 'string') return location;
                let root = resolve(projectDir), file = isAbsolute(path) ? path : resolve(projectDir, path);
                try { root = realpathSync(root); file = realpathSync(file); } catch { /* /file will reject missing paths */ }
                const rel = relative(root, file);
                return rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
                  ? { ...location, agentwarpPath: rel } : location;
              });
            }
            if (msg.update.sessionUpdate === 'config_option_update') {
              sess.configOptions = msg.update.configOptions;
            } else if (msg.update.sessionUpdate === 'current_mode_update') {
              const currentModeId = (msg.update as { currentModeId?: unknown }).currentModeId;
              if (typeof currentModeId === "string") {
                sess.modes = { ...(sess.modes ?? { availableModes: [] }), currentModeId };
                emit({ type: "acp/mode", sessionId: sess.sessionId, currentModeId });
              }
            }
            void appendTranscript(projectDir, sess.sessionId, {
              kind: "update",
              update: msg.update,
            }).catch(() => undefined);
            emit({ type: "acp/update", sessionId: sess.sessionId, update: msg.update });
          } else {
            sess.turnRunning = false;
            const turnId = sess.currentTurn;
            sess.currentTurn = null;
            if (sess.liveTimer) {
              clearTimeout(sess.liveTimer);
              sess.liveTimer = null;
            }
            void appendTranscript(projectDir, sess.sessionId, {
              kind: "done",
              stopReason: msg.stopReason,
            }).catch(() => undefined);
            emit({ type: "acp/done", sessionId: sess.sessionId, stopReason: msg.stopReason });
            if (turnId && turnStore) {
              try {
                const targets = await turnStore.diff(sess.sessionId, turnId);
                if (!disposed) emit({ type: "acp/changes", sessionId: sess.sessionId, turnId, final: true, targets });
              } catch (e) {
                log(`acp/changes (final) diff failed: ${(e as Error)?.message ?? e}`);
              }
            }
          }
        }
      } catch (e) {
        if (disposed) return;
        sess.turnRunning = false;
        const conn = conns.get(sess.agentId);
        if (!conn || conn.dead) {
          // onChildExit already emitted acp/error for running turns.
          sessions.delete(sess.sessionId);
          return;
        }
        const message = `session ${sess.sessionId}: ${(e as Error)?.message ?? e}`;
        log(message);
        emit({ type: "acp/error", sessionId: sess.sessionId, message });
      }
    })();
  }

  async function doStart(agentId: string): Promise<void> {
    const defs = await agents();
    const def = defs.find((d) => d.id === agentId);
    if (!def) {
      emit({ type: "acp/error", message: `unknown agent: ${agentId}` });
      return;
    }
    let conn: ConnState;
    try {
      conn = await ensureConn(def);
    } catch (e) {
      emit({ type: "acp/error", message: (e as Error)?.message ?? String(e) });
      return;
    }
    if (conn.dead) {
      emit({ type: "acp/error", message: `agent ${agentId} exited before session start` });
      return;
    }
    try {
      const active = await conn.agent.buildSession(projectDir).start();
      const sessionId = active.sessionId;
      const sess: SessionState = { sessionId, agentId: def.id, active, turnRunning: false, currentTurn: null, liveTimer: null, pump: Promise.resolve(), configOptions: active.newSessionResponse.configOptions, modes: active.newSessionResponse.modes ?? modesOf(active.newSessionResponse.configOptions) };
      sessions.set(sessionId, sess);
      conn.sessions.add(sessionId);
      startPump(sess);
      await writeSessionMeta(projectDir, sessionId, def.id);
      emit(sessionMessage(sess, conn));
    } catch (e) {
      emit({ type: "acp/error", message: `session/new failed for ${agentId}: ${(e as Error)?.message}` });
    }
  }

  async function doPrompt(msg: {
    sessionId?: string;
    text?: string;
    context?: unknown;
    mentions?: unknown;
    images?: unknown;
  }): Promise<void> {
    const sess = msg.sessionId ? findSession(msg.sessionId) : undefined;
    if (!sess) {
      emit({ type: "acp/error", sessionId: msg.sessionId, message: `unknown session: ${msg.sessionId}` });
      return;
    }
    if (sess.turnRunning) {
      emit({ type: "acp/error", sessionId: sess.sessionId, message: "a turn is already running for this session" });
      return;
    }
    const conn = conns.get(sess.agentId);
    if (!conn || conn.dead) {
      emit({ type: "acp/error", sessionId: sess.sessionId, message: `agent ${sess.agentId} is not running` });
      return;
    }
    const images = (Array.isArray(msg.images) ? msg.images : []).filter(
      (i): i is { mimeType: string; data: string } =>
        !!i && typeof i === "object" &&
        typeof (i as { mimeType?: unknown }).mimeType === "string" &&
        typeof (i as { data?: unknown }).data === "string",
    );
    if (images.length > 0 && !conn.caps?.promptCapabilities?.image) {
      emit({
        type: "acp/error",
        sessionId: sess.sessionId,
        message: "this agent does not support images (no promptCapabilities.image); remove the attachments and try again",
      });
      return;
    }
    const contextLine = formatEditorContext(msg.context);
    const text = typeof msg.text === "string" ? msg.text : "";
    const full = contextLine ? `${contextLine}\n\n${text}` : text;
    const mentions = Array.isArray(msg.mentions) ? (msg.mentions as Mention[]) : [];
    let links: Array<Record<string, unknown>> = [];
    try {
      links = await mentionLinks(projectDir, mentions);
    } catch (e) {
      log(`mention links failed: ${(e as Error)?.message ?? e}`);
    }
    const blocks: Array<Record<string, unknown>> = [{ type: "text", text: full }, ...links];
    for (const img of images) blocks.push({ type: "image", mimeType: img.mimeType, data: img.data });
    turnSeq += 1;
    const turnId = `t${Date.now().toString(36)}-${turnSeq}`;
    if (turnStore) {
      try {
        await turnStore.snapshot(sess.sessionId, turnId);
      } catch (e) {
        emit({ type: "acp/error", sessionId: sess.sessionId, message: `checkpoint failed: ${(e as Error)?.message ?? e}` });
        return;
      }
    }
    sess.turnRunning = true;
    sess.currentTurn = turnStore ? turnId : null;
    if (turnStore) {
      emit({ type: "acp/turn-start", sessionId: sess.sessionId, turnId, rev: turnStore.getRev() });
    }
    void appendTranscript(projectDir, sess.sessionId, { kind: "user", text: full }).catch(() => undefined);
    // Fire-and-forget: the pump loop observes updates + the final stop, so
    // handle() must stay responsive (e.g. permission replies arrive via
    // handle() while the turn is running).
    void sess.active
      .prompt(blocks as Parameters<ActiveSession["prompt"]>[0])
      .then(
        () => undefined,
        (e: unknown) => {
          // If the host is gone or the session was already cleaned up (e.g.
          // agent death, which emits its own acp/error), stay quiet to avoid
          // double-reporting.
          if (disposed || !sessions.has(sess.sessionId)) return;
          sess.turnRunning = false;
          sess.currentTurn = null;
          if (sess.liveTimer) {
            clearTimeout(sess.liveTimer);
            sess.liveTimer = null;
          }
          emit({
            type: "acp/error",
            sessionId: sess.sessionId,
            message: `prompt failed: ${(e as Error)?.message ?? e}`,
          });
        },
      );
  }

  async function doCancel(sessionId: string): Promise<void> {
    const sess = findSession(sessionId);
    if (!sess) {
      emit({ type: "acp/error", sessionId, message: `unknown session: ${sessionId}` });
      return;
    }
    const conn = conns.get(sess.agentId);
    if (!conn || conn.dead) {
      sess.turnRunning = false;
      emit({ type: "acp/error", sessionId, message: `agent ${sess.agentId} is not running` });
      return;
    }
    try {
      await conn.agent.notify("session/cancel", { sessionId });
    } catch (e) {
      emit({ type: "acp/error", sessionId, message: `cancel failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function replayEntries(sessionId: string, entries: unknown[], reply: (msg: object) => void): Promise<void> {
    for (const entry of entries) {
      const e = entry as { kind?: string; update?: unknown; stopReason?: string };
      if (e.kind === "update") {
        reply({ type: "acp/update", sessionId, update: e.update });
      } else if (e.kind === "user") {
        reply({
          type: "acp/update",
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: (e as { text?: string }).text ?? "" },
          },
        });
      } else if (e.kind === "done") {
        reply({ type: "acp/done", sessionId, stopReason: e.stopReason });
      }
      // permission-auto entries are host-internal; skip them on replay.
    }
  }

  async function doHistory(sessionId: string, reply: (msg: object) => void): Promise<void> {
    const session = findSession(sessionId);
    const entries = await readTranscript(projectDir, sessionId);
    if (!entries) {
      reply({ type: "acp/error", sessionId, message: `no transcript for session ${sessionId}` });
      return;
    }
    await replayEntries(sessionId, entries, reply);
    if (session) reply({ type: "acp/config", sessionId, configOptions: session.configOptions });
  }

  function sessionMessage(sess: SessionState, conn: ConnState, extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      type: "acp/session",
      sessionId: sess.sessionId,
      agentId: sess.agentId,
      configOptions: sess.configOptions,
      modes: sess.modes ?? undefined,
      promptCapabilities: conn.caps?.promptCapabilities ?? undefined,
      ...extra,
    };
  }

  /** acp/load: resume a past session, or replay it read-only (P7 §5). */
  async function doLoad(sessionId: string, reply: (msg: object) => void): Promise<void> {
    const entries = await readTranscript(projectDir, sessionId);
    if (!entries) {
      reply({ type: "acp/error", sessionId, message: `no transcript for session ${sessionId}` });
      return;
    }
    const live = findSession(sessionId);
    if (live) {
      const conn = conns.get(live.agentId);
      await replayEntries(sessionId, entries, reply);
      if (conn && !conn.dead) reply(sessionMessage(live, conn));
      else reply({ type: "acp/session", sessionId, agentId: live.agentId, readOnly: true });
      return;
    }
    const agentId = await readSessionAgent(projectDir, sessionId);
    const def = agentId ? (await agents()).find((d) => d.id === agentId) : undefined;
    if (!def) {
      await replayEntries(sessionId, entries, reply);
      reply({ type: "acp/session", sessionId, agentId: agentId ?? "unknown", readOnly: true });
      return;
    }
    let conn: ConnState;
    try {
      conn = await ensureConn(def);
    } catch (e) {
      log(`acp/load: cannot start ${def.id}: ${(e as Error)?.message ?? e}`);
      await replayEntries(sessionId, entries, reply);
      reply({ type: "acp/session", sessionId, agentId: def.id, readOnly: true });
      return;
    }
    if (conn.dead) {
      await replayEntries(sessionId, entries, reply);
      reply({ type: "acp/session", sessionId, agentId: def.id, readOnly: true });
      return;
    }
    const caps = conn.caps;
    const supportsLoad = caps?.loadSession === true;
    const supportsResume = caps?.sessionCapabilities?.resume != null;
    if (!supportsLoad && !supportsResume) {
      await replayEntries(sessionId, entries, reply);
      reply({ type: "acp/session", sessionId, agentId: def.id, readOnly: true });
      return;
    }
    try {
      let loaded: { modes?: SessionState["modes"]; configOptions?: SessionState["configOptions"] } | void;
      if (supportsLoad) {
        loaded = (await conn.agent.request("session/load", { sessionId, cwd: projectDir, mcpServers: [] })) as
          | { modes?: SessionState["modes"]; configOptions?: SessionState["configOptions"] }
          | void;
      } else {
        loaded = (await conn.agent.request("session/resume", { sessionId, cwd: projectDir })) as
          | { modes?: SessionState["modes"]; configOptions?: SessionState["configOptions"] }
          | void;
      }
      const active = (
        conn.agent as unknown as {
          attachSession: (r: unknown) => ActiveSession;
        }
      ).attachSession({
        sessionId,
        modes: loaded?.modes ?? null,
        configOptions: loaded?.configOptions ?? null,
      });
      const sess: SessionState = {
        sessionId,
        agentId: def.id,
        active,
        turnRunning: false,
        currentTurn: null,
        liveTimer: null,
        pump: Promise.resolve(),
        configOptions: active.newSessionResponse.configOptions,
        modes: active.newSessionResponse.modes ?? modesOf(active.newSessionResponse.configOptions),
      };
      sessions.set(sessionId, sess);
      conn.sessions.add(sessionId);
      startPump(sess);
      // History arrives as acp/update: session/load replays it; for resume
      // the agent sends no history, so replay the transcript to the requester.
      if (!supportsLoad) await replayEntries(sessionId, entries, reply);
      emit(sessionMessage(sess, conn));
    } catch (e) {
      log(`acp/load: session load/resume failed, read-only replay: ${(e as Error)?.message ?? e}`);
      await replayEntries(sessionId, entries, reply);
      reply({ type: "acp/session", sessionId, agentId: def.id, readOnly: true });
    }
  }

  /** acp/restore: write a checkpoint back; the bridge cycle packs + pushes. */
  async function doRestore(sessionId: string, turnId: string): Promise<void> {
    const sess = findSession(sessionId);
    if (sess?.turnRunning) {
      emit({ type: "acp/error", sessionId, message: "cannot restore while a turn is running for this session" });
      return;
    }
    if (!turnStore) {
      emit({ type: "acp/error", sessionId, message: "checkpoints are not available" });
      return;
    }
    if (!turnId) {
      emit({ type: "acp/error", sessionId, message: "acp/restore needs a turnId" });
      return;
    }
    try {
      const rev = await turnStore.restore(sessionId, turnId);
      emit({ type: "acp/restored", sessionId, turnId, rev });
    } catch (e) {
      emit({ type: "acp/error", sessionId, message: `restore failed: ${(e as Error)?.message ?? e}` });
    }
  }

  /** acp/changes: (re)compute the change summary for a turn. */
  async function doChanges(sessionId: string, turnId: string, reply: (msg: object) => void): Promise<void> {
    if (!turnStore) {
      reply({ type: "acp/error", sessionId, message: "checkpoints are not available" });
      return;
    }
    if (!turnId) {
      reply({ type: "acp/error", sessionId, message: "acp/changes needs a turnId" });
      return;
    }
    try {
      const targets = await turnStore.diff(sessionId, turnId);
      const sess = findSession(sessionId);
      reply({
        type: "acp/changes",
        sessionId,
        turnId,
        final: !(sess?.turnRunning && sess.currentTurn === turnId),
        targets,
      });
    } catch (e) {
      reply({ type: "acp/error", sessionId, message: `changes failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function doSessions(reply: (msg: object) => void): Promise<void> {
    reply({ type: "acp/sessions", list: await listSessions(projectDir) });
  }

  /** acp/set-mode: switch the session mode via ACP session/set_mode (P7 §5). */
  async function doSetMode(sessionId: string, modeId: string): Promise<void> {
    const sess = findSession(sessionId);
    if (!sess) {
      emit({ type: "acp/error", sessionId, message: `unknown session: ${sessionId}` });
      return;
    }
    if (!modeId) {
      emit({ type: "acp/error", sessionId, message: "acp/set-mode needs a modeId" });
      return;
    }
    const conn = conns.get(sess.agentId);
    if (!conn || conn.dead) {
      emit({ type: "acp/error", sessionId, message: `agent ${sess.agentId} is not running` });
      return;
    }
    try {
      await conn.agent.request("session/set_mode", { sessionId: sess.sessionId, modeId });
      sess.modes = { ...(sess.modes ?? { availableModes: [] }), currentModeId: modeId };
      emit({ type: "acp/mode", sessionId: sess.sessionId, currentModeId: modeId });
    } catch (e) {
      emit({ type: "acp/error", sessionId, message: `set-mode failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function handle(msg: unknown, reply: (msg: object) => void = emit): Promise<void> {
    if (disposed) return;
    const m = msg as { type?: string } | null;
    if (!m || typeof m !== "object" || typeof m.type !== "string") {
      log("acp: ignoring malformed message", msg);
      return;
    }
    const full = m as Record<string, unknown>;
    try {
      switch (m.type) {
        case "acp/agents": {
          const defs = await agents();
          const list: AgentStatus[] = await detectAll(defs);
          reply({ type: "acp/agents", list });
          break;
        }
        case "acp/start":
          await doStart(String(full.agentId ?? ""));
          break;
        case "acp/prompt":
          await doPrompt({
            sessionId: typeof full.sessionId === "string" ? full.sessionId : undefined,
            text: typeof full.text === "string" ? full.text : "",
            context: full.context,
            mentions: full.mentions,
            images: full.images,
          });
          break;
        case "acp/cancel":
          await doCancel(String(full.sessionId ?? ""));
          break;
        case "acp/permission":
          settlePermission(
            String(full.requestId ?? ""),
            typeof full.optionId === "string" ? full.optionId : null,
          );
          break;
        case "acp/history":
          await doHistory(String(full.sessionId ?? ""), reply);
          break;
        case "acp/set-config": {
          const sess = findSession(String(full.sessionId ?? ""));
          if (!sess) throw new Error(`unknown session: ${full.sessionId}`);
          const conn = conns.get(sess.agentId);
          if (!conn || conn.dead) throw new Error(`agent ${sess.agentId} is not running`);
          const result = await conn.agent.request('session/set_config_option', { sessionId: sess.sessionId, configId: String(full.optionId ?? ""), value: String(full.value ?? "") });
          sess.configOptions = result.configOptions;
          emit({ type: "acp/config", sessionId: sess.sessionId, configOptions: result.configOptions });
          break;
        }
        case "acp/set-mode":
          await doSetMode(String(full.sessionId ?? ""), String(full.modeId ?? ""));
          break;
        case "acp/sessions":
          await doSessions(reply);
          break;
        case "acp/load":
          await doLoad(String(full.sessionId ?? ""), reply);
          break;
        case "acp/restore":
          await doRestore(String(full.sessionId ?? ""), String(full.turnId ?? ""));
          break;
        case "acp/changes":
          await doChanges(String(full.sessionId ?? ""), String(full.turnId ?? ""), reply);
          break;
        default:
          log(`acp: ignoring unknown message type ${m.type}`);
      }
    } catch (e) {
      emit({ type: "acp/error", message: `${m.type} failed: ${(e as Error)?.message ?? e}` });
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    for (const [, sess] of [...sessions]) {
      if (sess.liveTimer) {
        clearTimeout(sess.liveTimer);
        sess.liveTimer = null;
      }
    }
    for (const [id] of [...pendingPerms]) settlePermission(id, null);
    for (const [, conn] of [...conns]) {
      try {
        conn.connection.close();
      } catch {
        /* ignore */
      }
      try {
        conn.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    // Give children a moment to exit, then SIGKILL stragglers.
    await new Promise((r) => setTimeout(r, 300));
    for (const [, conn] of [...conns]) {
      try {
        if (conn.child.exitCode == null && conn.child.signalCode == null) conn.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    sessions.clear();
  }

  return { handle, dispose, isTurnRunning, onBaseUpdated };
}
